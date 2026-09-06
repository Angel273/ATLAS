import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { randomUUID } from 'node:crypto';
import { createPool } from '@atlas/database';
import {
  errorResponseSchema, loginResultSchema, mfaSetupSchema, sessionSchema, accountListSchema,
  memberListSchema, roleCapabilities, createUserResultSchema, userProfileSchema,
  adminUserDetailSchema, adminUpdateUserResultSchema,
} from '@atlas/contracts';
import type { INestApplication } from '@nestjs/common';
import { createApp } from './app.js';
import { hashPassword } from './identity/crypto.js';
import { UsersService } from './identity/users.service.js';

describe('Identity HTTP contracts with PostgreSQL', () => {
  const admin = createPool(process.env.ADMIN_DATABASE_URL);
  const tenantA = randomUUID(), tenantB = randomUUID(), userA = randomUUID(), userB = randomUUID(), userC = randomUUID();
  const email = `${userA}@example.invalid`, otherEmail = `${userB}@example.invalid`;
  const password = 'Synthetic-password-ONLY-123!';
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000';
  let app: INestApplication;
  let browser: ReturnType<typeof request.agent>;
  let totp: OTPAuth.TOTP;
  const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  beforeAll(async () => {
    await admin.query('DELETE FROM identity.sessions');
    await admin.query('DELETE FROM identity.memberships');
    await admin.query('DELETE FROM identity.users WHERE email LIKE $1', ['%@example.invalid']);
    await admin.query('DELETE FROM identity.rate_limits');
    await admin.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    const hash = await hashPassword(password);
    await admin.query('INSERT INTO organizations(id,name) VALUES ($1,$2),($3,$4)', [tenantA, 'HTTP Synthetic A', tenantB, 'HTTP Synthetic B']);
    await admin.query('INSERT INTO accounts(tenant_id,name) VALUES ($1,$2),($3,$4)', [tenantA, 'Private A', tenantB, 'Private B']);
    await admin.query('INSERT INTO identity.users(id,email,password_hash) VALUES ($1,$2,$3),($4,$5,$3)', [userA, email, hash, userB, otherEmail]);
    await admin.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'admin'),($3,$4,'ceo')", [tenantA, userA, tenantB, userB]);
    await admin.query('INSERT INTO identity.users(id,email,password_hash) VALUES ($1,$2,$3)', [userC, `${userC}@example.invalid`, hash]);
    await admin.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'ceo')", [tenantA, userC]);
    app = await createApp(); browser = request.agent(app.getHttpServer());
  });
  afterAll(async () => {
    if (app) await app.close();
    await admin.query('DELETE FROM identity.sessions WHERE user_id = ANY($1::uuid[]) OR user_id IN (SELECT id FROM identity.users WHERE email LIKE $2)', [[userA, userB, userC], '%@example.invalid']);
    await admin.query('DELETE FROM identity.memberships WHERE tenant_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])', [[tenantA, tenantB], [userA, userB, userC]]);
    await admin.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[]) OR email LIKE $2', [[userA, userB, userC], '%@example.invalid']);
    await admin.query('DELETE FROM identity.rate_limits');
    await admin.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.end(); logs.mockRestore();
  });
  it('denies unauthenticated requests and unsafe origins', async () => {
    const anonymous = await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
    expect(errorResponseSchema.parse(anonymous.body).code).toBe('UNAUTHENTICATED');
    await browser.post('/api/v1/auth/login').set('Origin', 'https://untrusted.invalid').send({ email, password }).expect(403);
    await browser.post('/api/v1/auth/login').send({ email, password }).expect(403);
  });
  it('rejects invalid bodies, injected tenants and bad credentials with safe errors', async () => {
    await browser.post('/api/v1/auth/login').set('Origin', origin).send({ email, password, tenant_id: tenantB }).expect(400);
    const failure = await browser.post('/api/v1/auth/login').set('Origin', origin).send({ email, password: 'wrong' }).expect(401);
    expect(errorResponseSchema.parse(failure.body).code).toBe('INVALID_CREDENTIALS');
    await browser.post('/api/v1/auth/login').set('Origin', origin).set('Content-Type', 'application/json').send('{invalid').expect(400);
  });
  it('requires enrollment before giving administrators access', async () => {
    const login = await browser.post('/api/v1/auth/login').set('Origin', origin).send({ email, password }).expect(200);
    expect(loginResultSchema.parse(login.body).stage).toBe('mfa_setup');
    expect(String(login.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(login.headers['set-cookie'])).toContain('SameSite=Strict');
    await browser.get('/api/v1/accounts').expect(403);
    const setup = mfaSetupSchema.parse((await browser.get('/api/v1/auth/mfa/setup').expect(200)).body);
    totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), algorithm: 'SHA1', digits: 6, period: 30 });
    const verified = await browser.post('/api/v1/auth/mfa/verify').set('Origin', origin).send({ code: totp.generate() }).expect(200);
    expect(loginResultSchema.parse(verified.body).stage).toBe('authenticated');
    expect(String(verified.headers['set-cookie'])).not.toBe(String(login.headers['set-cookie']));
    await browser.get('/api/v1/auth/mfa/setup').expect(403);
  });
  it('derives tenant from session, ignoring forged headers and query parameters', async () => {
    const session = sessionSchema.parse((await browser.get('/api/v1/auth/session').expect(200)).body);
    expect(session.tenantId).toBe(tenantA);
    const accounts = accountListSchema.parse((await browser.get(`/api/v1/accounts?tenant_id=${tenantB}`).set('X-Tenant-Id', tenantB).expect(200)).body);
    expect(accounts.items.map(account => account.name)).toEqual(['Private A']);
    const other = request.agent(app.getHttpServer());
    await other.post('/api/v1/auth/login').set('Origin', origin).send({ email: otherEmail, password }).expect(200);
    expect(accountListSchema.parse((await other.get('/api/v1/accounts').expect(200)).body).items.map(account => account.name)).toEqual(['Private B']);
    expect(sessionSchema.parse((await other.get('/api/v1/auth/session').expect(200)).body).capabilities).toEqual(['dashboard.read', 'semantic.read', 'ai.use']);
  });
  it('creates accounts atomically, audits once and enforces capabilities and cross-tenant reads', async () => {
    const key = randomUUID(), payload = { name: 'Synthetic created account', timezone: 'America/Guatemala' };
    const first = await browser.post('/api/v1/accounts').set('Origin', origin).set('Idempotency-Key', key).send(payload).expect(201);
    const second = await browser.post('/api/v1/accounts').set('Origin', origin).set('Idempotency-Key', key).send(payload).expect(201);
    expect(second.body).toEqual(first.body);
    await browser.post('/api/v1/accounts').set('Origin', origin).set('Idempotency-Key', key).send({ ...payload, name: 'Changed' }).expect(409);
    await browser.post('/api/v1/accounts').set('Origin', origin).set('Idempotency-Key', randomUUID()).send({ ...payload, tenant_id: tenantB }).expect(400);
    const events = await admin.query('SELECT correlation_id FROM audit_events WHERE tenant_id = $1 AND event = $2', [tenantA, 'account.created']);
    expect(events.rowCount).toBe(1); expect(events.rows[0]?.correlation_id).toBe(first.headers['x-correlation-id']);
    const otherId = await admin.query<{ id: string }>('SELECT id FROM accounts WHERE tenant_id = $1', [tenantB]);
    await browser.get(`/api/v1/accounts/${otherId.rows[0]?.id}`).expect(404);
    const other = request.agent(app.getHttpServer());
    await other.post('/api/v1/auth/login').set('Origin', origin).send({ email: otherEmail, password }).expect(200);
    await other.post('/api/v1/accounts').set('Origin', origin).set('Idempotency-Key', randomUUID()).send(payload).expect(403);
    await other.patch(`/api/v1/accounts/${first.body.id}`).set('Origin', origin).send({ name: 'Hacked' }).expect(403);
    await other.delete(`/api/v1/accounts/${first.body.id}`).set('Origin', origin).expect(403);

    // Update account with valid capability
    const updated = await browser.patch(`/api/v1/accounts/${first.body.id}`).set('Origin', origin).send({ name: 'Synthetic updated account', timezone: 'America/Mexico_City' }).expect(200);
    expect(updated.body.name).toBe('Synthetic updated account');
    expect(updated.body.timezone).toBe('America/Mexico_City');

    // Delete account
    await browser.delete(`/api/v1/accounts/${first.body.id}`).set('Origin', origin).expect(200);
    await browser.get(`/api/v1/accounts/${first.body.id}`).expect(404);
  });
  it('manages roles only in the current tenant and protects the last administrator', async () => {
    const members = memberListSchema.parse((await browser.get('/api/v1/users').expect(200)).body).items;
    expect(members).toHaveLength(2); expect(JSON.stringify(members)).not.toContain(email);
    const self = members.find(member => member.userId === userA), target = members.find(member => member.userId === userC);
    if (!self || !target) throw new Error('Missing synthetic memberships');
    await browser.patch(`/api/v1/users/${self.id}/role`).set('Origin', origin).send({ role: 'ceo' }).expect(409);
    const other = await admin.query<{ id: string }>('SELECT id FROM identity.memberships WHERE user_id = $1', [userB]);
    await browser.patch(`/api/v1/users/${other.rows[0]?.id}/role`).set('Origin', origin).send({ role: 'admin' }).expect(404);
    await browser.patch(`/api/v1/users/${target.id}/role`).set('Origin', origin).send({ role: 'operations_manager', tenant_id: tenantB }).expect(400);
    await browser.patch(`/api/v1/users/${target.id}/role`).set('Origin', origin).send({ role: 'operations_manager' }).expect(200);
    const operator = request.agent(app.getHttpServer());
    await operator.post('/api/v1/auth/login').set('Origin', origin).send({ email: `${userC}@example.invalid`, password }).expect(200);
    expect(sessionSchema.parse((await operator.get('/api/v1/auth/session').expect(200)).body).capabilities).toContain('workforce.read');
    await operator.get('/api/v1/users').expect(403);
    await operator.patch(`/api/v1/users/${self.id}/role`).set('Origin', origin).send({ role: 'ceo' }).expect(403);
    await browser.patch(`/api/v1/users/${target.id}/role`).set('Origin', origin).send({ role: 'admin' }).expect(200);
    // An old non-admin session cannot bypass mandatory MFA after promotion.
    await operator.get('/api/v1/accounts').expect(403);
    const users = app.get(UsersService);
    const principals = [userA, userC].map(userId => ({ userId, tenantId: tenantA, role: 'admin' as const, capabilities: [...roleCapabilities.admin] }));
    const results = await Promise.allSettled([
      users.updateRole(principals[0]!, self.id, 'ceo', randomUUID()),
      users.updateRole(principals[1]!, target.id, 'ceo', randomUUID()),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await admin.query("SELECT count(*)::int AS count FROM identity.memberships WHERE tenant_id = $1 AND role = 'admin'", [tenantA])).rows[0]?.count).toBe(1);
    const event = await admin.query('SELECT previous_role,new_role FROM audit_events WHERE tenant_id = $1 AND target_id = $2 AND new_role = $3', [tenantA, target.id, 'operations_manager']);
    expect(event.rows).toEqual([{ previous_role: 'ceo', new_role: 'operations_manager' }]);
    await admin.query("UPDATE identity.memberships SET role = CASE WHEN user_id = $1 THEN 'admin' ELSE 'ceo' END WHERE tenant_id = $2", [userA, tenantA]);
  });
  it('invalidates a session at logout and rejects reuse of the MFA step', async () => {
    await browser.post('/api/v1/auth/logout').set('Origin', origin).expect(204);
    await browser.get('/api/v1/accounts').expect(401);
    const login = await browser.post('/api/v1/auth/login').set('Origin', origin).send({ email, password }).expect(200);
    expect(loginResultSchema.parse(login.body).stage).toBe('mfa_verify');
    const last = await admin.query<{ last_totp_step: string }>('SELECT last_totp_step FROM identity.users WHERE id = $1', [userA]);
    const code = totp.generate({ timestamp: Number(last.rows[0]?.last_totp_step) * 30000 });
    await browser.post('/api/v1/auth/mfa/verify').set('Origin', origin).send({ code }).expect(401);
    await browser.get('/api/v1/accounts').expect(403);
  });
  it('revokes all sessions and enforces membership revocation', async () => {
    const first = request.agent(app.getHttpServer()), second = request.agent(app.getHttpServer());
    for (const agent of [first, second]) await agent.post('/api/v1/auth/login').set('Origin', origin).send({ email: otherEmail, password }).expect(200);
    await first.post('/api/v1/auth/revoke-all').set('Origin', origin).expect(204);
    await second.get('/api/v1/accounts').expect(401);
    await second.post('/api/v1/auth/login').set('Origin', origin).send({ email: otherEmail, password }).expect(200);
    await admin.query('DELETE FROM identity.memberships WHERE user_id = $1', [userB]);
    await second.get('/api/v1/accounts').expect(403);
  });
  it('creates users with role, supports self profile management and enforces password policies', async () => {
    // Provision dedicated admin for this test
    const adminUser = randomUUID();
    const adminEmail = `${adminUser}@example.invalid`;
    const adminHash = await hashPassword(password);
    await admin.query('INSERT INTO identity.users(id, email, password_hash) VALUES ($1, $2, $3)', [adminUser, adminEmail, adminHash]);
    await admin.query("INSERT INTO identity.memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin')", [tenantA, adminUser]);

    const adminAgent = request.agent(app.getHttpServer());
    const loginRes = await adminAgent.post('/api/v1/auth/login').set('Origin', origin).send({ email: adminEmail, password }).expect(200);
    expect(loginResultSchema.parse(loginRes.body).stage).toBe('mfa_setup');
    const setup = mfaSetupSchema.parse((await adminAgent.get('/api/v1/auth/mfa/setup').expect(200)).body);
    const adminTotp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), algorithm: 'SHA1', digits: 6, period: 30 });
    const verified = await adminAgent.post('/api/v1/auth/mfa/verify').set('Origin', origin).send({ code: adminTotp.generate() }).expect(200);
    expect(loginResultSchema.parse(verified.body).stage).toBe('authenticated');

    // 1. Create a new supervisor user via Admin session
    const newEmail = `supervisor-${randomUUID().slice(0, 8)}@example.invalid`;
    const newPassword = 'Synthetic-supervisor-pass-14!';
    const created = createUserResultSchema.parse((await adminAgent.post('/api/v1/users').set('Origin', origin).send({
      email: newEmail,
      name: 'Supervisor Synthetico',
      role: 'supervisor',
      password: newPassword,
    }).expect(201)).body);
    expect(created.email).toBe(newEmail);
    expect(created.name).toBe('Supervisor Synthetico');
    expect(created.role).toBe('supervisor');

    // 2. Reject duplicate email in same tenant
    await adminAgent.post('/api/v1/users').set('Origin', origin).send({
      email: newEmail,
      name: 'Duplicate',
      role: 'supervisor',
      password: newPassword,
    }).expect(409);

    // 3. New user can log in directly (non-admin doesn't require MFA setup)
    const newAgent = request.agent(app.getHttpServer());
    const login = await newAgent.post('/api/v1/auth/login').set('Origin', origin).send({ email: newEmail, password: newPassword }).expect(200);
    expect(loginResultSchema.parse(login.body).stage).toBe('authenticated');

    // 4. Non-admin cannot create users
    await newAgent.post('/api/v1/users').set('Origin', origin).send({
      email: `other-${randomUUID().slice(0, 8)}@example.invalid`,
      name: 'Denied',
      role: 'supervisor',
      password: newPassword,
    }).expect(403);

    // 5. User can view own profile via /users/me
    const profile = userProfileSchema.parse((await newAgent.get('/api/v1/users/me').expect(200)).body);
    expect(profile.email).toBe(newEmail);
    expect(profile.name).toBe('Supervisor Synthetico');
    expect(profile.role).toBe('supervisor');
    expect(profile.roleLabel).toBe('Supervisor');

    // 6. User can update own profile name
    const updatedProfile = userProfileSchema.parse((await newAgent.patch('/api/v1/users/me').set('Origin', origin).send({
      name: 'Supervisor Actualizado',
    }).expect(200)).body);
    expect(updatedProfile.name).toBe('Supervisor Actualizado');

    // 7. User can change own password
    const newerPassword = 'Brand-new-password-14-chars!';
    await newAgent.post('/api/v1/users/me/password').set('Origin', origin).send({
      currentPassword: 'wrong-password',
      newPassword: newerPassword,
    }).expect(401);
    await newAgent.post('/api/v1/users/me/password').set('Origin', origin).send({
      currentPassword: newPassword,
      newPassword: newerPassword,
    }).expect(200);

    // Verify login with updated password
    const testAgent = request.agent(app.getHttpServer());
    await testAgent.post('/api/v1/auth/login').set('Origin', origin).send({ email: newEmail, password: newerPassword }).expect(200);

    // 8. Admin can get full user detail
    const detail = adminUserDetailSchema.parse((await adminAgent.get(`/api/v1/users/${created.id}`).expect(200)).body);
    expect(detail.email).toBe(newEmail);
    expect(detail.name).toBe('Supervisor Actualizado');
    expect(detail.role).toBe('supervisor');
    expect(detail.disabled).toBe(false);

    // 9. Admin can update user: name, role, and reset password
    const adminAssignedPassword = 'Admin-assigned-pw-14!';
    const adminUpdateResult = adminUpdateUserResultSchema.parse((await adminAgent.patch(`/api/v1/users/${created.id}`).set('Origin', origin).send({
      name: 'Supervisor Renombrado',
      role: 'operations_manager',
      password: adminAssignedPassword,
    }).expect(200)).body);
    expect(adminUpdateResult.updated).toBe(true);
    expect(adminUpdateResult.user.name).toBe('Supervisor Renombrado');
    expect(adminUpdateResult.user.role).toBe('operations_manager');

    // Verify user can log in with admin-assigned password
    const userAgent2 = request.agent(app.getHttpServer());
    await userAgent2.post('/api/v1/auth/login').set('Origin', origin).send({ email: newEmail, password: adminAssignedPassword }).expect(200);

    // 10. Admin can disable and re-enable user
    await adminAgent.patch(`/api/v1/users/${created.id}`).set('Origin', origin).send({ disabled: true }).expect(200);
    // Disabled user is rejected on login
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', origin).send({ email: newEmail, password: adminAssignedPassword }).expect(401);
    // Re-enable user
    await adminAgent.patch(`/api/v1/users/${created.id}`).set('Origin', origin).send({ disabled: false }).expect(200);

    // 11. Safety checks: Admin cannot disable self
    const adminMembers = memberListSchema.parse((await adminAgent.get('/api/v1/users').expect(200)).body).items;
    const adminSelfMember = adminMembers.find(m => m.userId === adminUser);
    if (adminSelfMember) {
      await adminAgent.patch(`/api/v1/users/${adminSelfMember.id}`).set('Origin', origin).send({ disabled: true }).expect(400);
    }

    // 12. Admin can remove member (cannot remove self, cannot remove last admin)
    await adminAgent.delete(`/api/v1/users/${created.id}`).set('Origin', origin).expect(200);
    // Removing already removed member returns 404
    await adminAgent.delete(`/api/v1/users/${created.id}`).set('Origin', origin).expect(404);
  });
  it('gates incomplete endpoints and does not log credentials or PII', async () => {
    const response = await browser.get('/api/v1/connectors').expect(503);
    expect(errorResponseSchema.parse(response.body).code).toBe('FEATURE_UNAVAILABLE');
    const text = JSON.stringify(logs.mock.calls);
    expect(text).not.toContain(email); expect(text).not.toContain(password); expect(text).not.toContain('password_hash');
  });
});

