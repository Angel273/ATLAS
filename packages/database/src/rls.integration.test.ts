import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool, withTenant, withIdentity } from './index.js';

describe('PostgreSQL RLS with actual restricted roles', () => {
  const admin = createPool(process.env.ADMIN_DATABASE_URL);
  const app = createPool(process.env.DATABASE_URL);
  const auth = createPool(process.env.AUTH_DATABASE_URL);
  const tenantA = randomUUID(), tenantB = randomUUID(), userA = randomUUID(), userB = randomUUID();
  beforeAll(async () => {
    await admin.query('INSERT INTO organizations(id,name) VALUES ($1,$2),($3,$4)', [tenantA, 'Synthetic A', tenantB, 'Synthetic B']);
    await admin.query('INSERT INTO accounts(tenant_id,name) VALUES ($1,$2),($3,$4)', [tenantA, 'Account A', tenantB, 'Account B']);
    await admin.query('INSERT INTO identity.users(id,email,password_hash) VALUES ($1,$2,$3),($4,$5,$3)', [userA, `${userA}@example.invalid`, 'not-a-password', userB, `${userB}@example.invalid`]);
    await admin.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'admin'),($3,$4,'admin')", [tenantA, userA, tenantB, userB]);
  });
  afterAll(async () => {
    await admin.query('DELETE FROM identity.memberships WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [[userA, userB]]);
    await admin.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await Promise.all([admin.end(), app.end(), auth.end()]);
  });
  it('runs as a non-superuser without BYPASSRLS', async () => {
    const result = await app.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('denies unscoped reads', async () => { expect((await app.query('SELECT * FROM accounts')).rows).toEqual([]); });
  it('isolates concurrent tenant reads and clears context after commit', async () => {
    const [a, b] = await Promise.all([withTenant(app, tenantA, client => client.query('SELECT name FROM accounts')), withTenant(app, tenantB, client => client.query('SELECT name FROM accounts'))]);
    expect(a.rows).toEqual([{ name: 'Account A' }]); expect(b.rows).toEqual([{ name: 'Account B' }]);
    expect((await app.query('SELECT * FROM accounts')).rows).toEqual([]);
  });
  it('rejects cross-tenant writes and clears context after rollback', async () => {
    await expect(withTenant(app, tenantA, client => client.query('INSERT INTO accounts(tenant_id,name) VALUES ($1,$2)', [tenantB, 'Forbidden']))).rejects.toMatchObject({ code: '42501' });
    expect((await app.query('SELECT * FROM accounts')).rows).toEqual([]);
    const result = await withTenant(app, tenantA, client => client.query('UPDATE accounts SET name = $1 WHERE tenant_id = $2', ['Forbidden', tenantB]));
    expect(result.rowCount).toBe(0);
  });
  it('restricts membership discovery to the verified identity', async () => {
    expect((await auth.query('SELECT * FROM identity.memberships')).rows).toEqual([]);
    const a = await withIdentity(auth, userA, client => client.query('SELECT tenant_id FROM identity.memberships'));
    expect(a.rows).toEqual([{ tenant_id: tenantA }]);
    await expect(app.query('SELECT * FROM identity.users')).rejects.toMatchObject({ code: '42501' });
    await expect(auth.query('SELECT * FROM accounts')).rejects.toMatchObject({ code: '42501' });
  });
  it('makes audit events append-only for the application role', async () => {
    await withTenant(app, tenantA, client => client.query('INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id) VALUES ($1,$2,$3,$4)', [tenantA, userA, 'test.created', randomUUID()]));
    await expect(withTenant(app, tenantA, client => client.query('DELETE FROM audit_events'))).rejects.toMatchObject({ code: '42501' });
    await expect(withTenant(app, tenantA, client => client.query("UPDATE audit_events SET event = 'changed'"))).rejects.toMatchObject({ code: '42501' });
  });
});
