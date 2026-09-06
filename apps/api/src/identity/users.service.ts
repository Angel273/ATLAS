import { z } from 'zod';
import { withIdentity, type PoolClient } from '@atlas/database';
import {
  memberListSchema, updateRoleSchema, createUserSchema, createUserResultSchema,
  removeMemberResultSchema, userProfileSchema, updateProfileSchema, changePasswordSchema,
  changePasswordResultSchema, roleLabels, type Role, type CreateUserInput,
  type UpdateProfileInput, type ChangePasswordInput,
  adminUserDetailSchema, adminUpdateUserSchema, adminUpdateUserResultSchema,
  type AdminUpdateUserInput,
} from '@atlas/contracts';
import { AuthService, requireCapability, type Principal } from './auth.service.js';
import { hashPassword, verifyPassword } from './crypto.js';
import { AppError } from '../common/errors.js';

export class UsersService {
  constructor(private readonly auth: AuthService) {}

  private async transaction<T>(principal: Principal, action: (client: PoolClient) => Promise<T>) {
    requireCapability(principal, 'user.manage');
    return withIdentity(this.auth.pool, principal.userId, async client => {
      await client.query("SELECT set_config('atlas.tenant_id',$1,true), set_config('atlas.manage_users','true',true)", [principal.tenantId]);
      // Serializes role and membership changes to preserve at least one administrator.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`users:${principal.tenantId}`]);
      // Recheck inside the transaction: another admin may have just revoked this actor.
      const actor = await client.query('SELECT 1 FROM identity.memberships WHERE user_id = $1 AND tenant_id = $2 AND role = $3', [principal.userId, principal.tenantId, 'admin']);
      if (!actor.rowCount) throw new AppError('FORBIDDEN', 403, 'No tienes permiso para administrar usuarios.');
      return action(client);
    });
  }

  async list(principal: Principal) {
    return this.transaction(principal, async client => {
      const members = await client.query<{
        id: string;
        user_id: string;
        email: string;
        name: string | null;
        role: Role;
        mfa_enabled: boolean;
        disabled: boolean;
      }>(
        `SELECT m.id, m.user_id, u.email, u.name, m.role, u.mfa_enabled, u.disabled
         FROM identity.memberships m
         JOIN identity.users u ON u.id = m.user_id
         WHERE m.tenant_id = $1
         ORDER BY m.id
         LIMIT 500`,
        [principal.tenantId]
      );
      return memberListSchema.parse({
        items: members.rows.map(member => ({
          id: member.id,
          userId: member.user_id,
          email: member.email.replace(/^(.).*@/, '$1***@'),
          name: member.name ?? '',
          role: member.role,
          mfaEnabled: member.mfa_enabled ?? false,
          disabled: member.disabled ?? false,
        })),
      });
    });
  }

  async createUser(principal: Principal, input: CreateUserInput, correlationId: string) {
    const data = createUserSchema.parse(input);
    z.uuid().parse(correlationId);
    return this.transaction(principal, async client => {
      const existingUser = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM identity.users WHERE email = $1',
        [data.email]
      );
      let userId: string;
      if (existingUser.rows[0]) {
        userId = existingUser.rows[0].id;
        const existingMember = await client.query(
          'SELECT 1 FROM identity.memberships WHERE tenant_id = $1 AND user_id = $2',
          [principal.tenantId, userId]
        );
        if (existingMember.rowCount) {
          throw new AppError('USER_ALREADY_MEMBER', 409, 'El usuario ya pertenece a esta organización.');
        }
      } else {
        const hash = await hashPassword(data.password);
        const created = await client.query<{ id: string }>(
          'INSERT INTO identity.users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
          [data.email, hash, data.name]
        );
        userId = created.rows[0]!.id;
      }

      const membership = await client.query<{ id: string }>(
        'INSERT INTO identity.memberships (tenant_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
        [principal.tenantId, userId, data.role]
      );

      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id, new_role) VALUES ($1, $2, $3, $4, $5, $6)',
        [principal.tenantId, principal.userId, 'membership.created', correlationId, membership.rows[0]!.id, data.role]
      );

      return createUserResultSchema.parse({
        id: membership.rows[0]!.id,
        userId,
        email: data.email,
        name: data.name,
        role: data.role,
      });
    });
  }

  async removeMember(principal: Principal, id: string, correlationId: string) {
    z.uuid().parse(id);
    z.uuid().parse(correlationId);
    return this.transaction(principal, async client => {
      const target = await client.query<{ id: string; user_id: string; role: Role }>(
        'SELECT id, user_id, role FROM identity.memberships WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, principal.tenantId]
      );
      if (!target.rows[0]) throw new AppError('MEMBER_NOT_FOUND', 404, 'Usuario no encontrado.');
      if (target.rows[0].user_id === principal.userId) {
        throw new AppError('CANNOT_REMOVE_SELF', 400, 'No puedes eliminar tu propia membresía.');
      }
      if (target.rows[0].role === 'admin') {
        const remaining = await client.query<{ count: string }>(
          "SELECT count(*) FROM identity.memberships WHERE tenant_id = $1 AND role = 'admin'",
          [principal.tenantId]
        );
        if (Number(remaining.rows[0]?.count ?? 0) <= 1) {
          throw new AppError('LAST_ADMIN_REQUIRED', 409, 'La organización debe conservar al menos un administrador.');
        }
      }
      await client.query('DELETE FROM identity.sessions WHERE user_id = $1 AND tenant_id = $2', [target.rows[0].user_id, principal.tenantId]);
      await client.query('DELETE FROM identity.memberships WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id, previous_role) VALUES ($1, $2, $3, $4, $5, $6)',
        [principal.tenantId, principal.userId, 'membership.removed', correlationId, id, target.rows[0].role]
      );
      return removeMemberResultSchema.parse({ removed: true });
    });
  }

  async updateRole(principal: Principal, id: string, role: Role, correlationId: string) {
    z.uuid().parse(id);
    updateRoleSchema.parse({ role });
    z.uuid().parse(correlationId);
    return this.transaction(principal, async client => {
      const target = await client.query<{ role: Role }>('SELECT role FROM identity.memberships WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, principal.tenantId]);
      if (!target.rows[0]) throw new AppError('MEMBER_NOT_FOUND', 404, 'Usuario no encontrado.');
      if (target.rows[0].role === role) return { updated: true as const };
      if (target.rows[0].role === 'admin' && role !== 'admin') {
        const remaining = await client.query<{ count: string }>("SELECT count(*) FROM identity.memberships WHERE tenant_id = $1 AND role = 'admin'", [principal.tenantId]);
        if (Number(remaining.rows[0]?.count ?? 0) <= 1) throw new AppError('LAST_ADMIN_REQUIRED', 409, 'La organización debe conservar al menos un administrador.');
      }
      await client.query('UPDATE identity.memberships SET role = $1 WHERE id = $2 AND tenant_id = $3', [role, id, principal.tenantId]);
      await client.query('INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id,target_id,previous_role,new_role) VALUES ($1,$2,$3,$4,$5,$6,$7)', [principal.tenantId, principal.userId, 'membership.role_changed', correlationId, id, target.rows[0].role, role]);
      return { updated: true as const };
    });
  }

  async getUserDetail(principal: Principal, id: string) {
    z.uuid().parse(id);
    return this.transaction(principal, async client => {
      const result = await client.query<{
        id: string;
        user_id: string;
        email: string;
        name: string | null;
        role: Role;
        mfa_enabled: boolean;
        disabled: boolean;
        created_at: Date;
      }>(
        `SELECT m.id, m.user_id, u.email, u.name, m.role, u.mfa_enabled, u.disabled, u.created_at
         FROM identity.memberships m
         JOIN identity.users u ON u.id = m.user_id
         WHERE m.id = $1 AND m.tenant_id = $2`,
        [id, principal.tenantId]
      );
      if (!result.rows[0]) throw new AppError('MEMBER_NOT_FOUND', 404, 'Usuario no encontrado.');
      const row = result.rows[0];
      return adminUserDetailSchema.parse({
        id: row.id,
        userId: row.user_id,
        name: row.name ?? '',
        email: row.email,
        role: row.role,
        mfaEnabled: row.mfa_enabled ?? false,
        disabled: row.disabled ?? false,
        createdAt: row.created_at.toISOString(),
      });
    });
  }

  async adminUpdateUser(principal: Principal, id: string, input: AdminUpdateUserInput, correlationId: string) {
    z.uuid().parse(id);
    z.uuid().parse(correlationId);
    const data = adminUpdateUserSchema.parse(input);
    return this.transaction(principal, async client => {
      const target = await client.query<{
        id: string;
        user_id: string;
        role: Role;
        email: string;
        name: string | null;
        mfa_enabled: boolean;
        disabled: boolean;
        created_at: Date;
      }>(
        `SELECT m.id, m.user_id, m.role, u.email, u.name, u.mfa_enabled, u.disabled, u.created_at
         FROM identity.memberships m
         JOIN identity.users u ON u.id = m.user_id
         WHERE m.id = $1 AND m.tenant_id = $2 FOR UPDATE`,
        [id, principal.tenantId]
      );
      if (!target.rows[0]) throw new AppError('MEMBER_NOT_FOUND', 404, 'Usuario no encontrado.');
      const current = target.rows[0];

      // Security check: cannot disable self
      if (data.disabled === true && current.user_id === principal.userId) {
        throw new AppError('CANNOT_DISABLE_SELF', 400, 'No puedes deshabilitar tu propia cuenta.');
      }

      // Security check: last active administrator protection
      const isDemotingAdmin = data.role && data.role !== 'admin' && current.role === 'admin';
      const isDisablingAdmin = data.disabled === true && current.role === 'admin';
      if (isDemotingAdmin || isDisablingAdmin) {
        const remaining = await client.query<{ count: string }>(
          `SELECT count(*) FROM identity.memberships m
           JOIN identity.users u ON u.id = m.user_id
           WHERE m.tenant_id = $1 AND m.role = 'admin' AND NOT u.disabled AND m.id <> $2`,
          [principal.tenantId, id]
        );
        if (Number(remaining.rows[0]?.count ?? 0) === 0) {
          throw new AppError('LAST_ADMIN_REQUIRED', 409, 'La organización debe conservar al menos un administrador activo.');
        }
      }

      // 1. Email check
      if (data.email && data.email !== current.email) {
        const existing = await client.query(
          'SELECT 1 FROM identity.users WHERE email = $1 AND id <> $2',
          [data.email, current.user_id]
        );
        if (existing.rowCount) {
          throw new AppError('EMAIL_ALREADY_IN_USE', 409, 'El correo electrónico ya está registrado por otro usuario.');
        }
      }

      // 2. Update role if changed
      let nextRole = current.role;
      if (data.role && data.role !== current.role) {
        await client.query(
          'UPDATE identity.memberships SET role = $1 WHERE id = $2 AND tenant_id = $3',
          [data.role, id, principal.tenantId]
        );
        nextRole = data.role;
      }

      // 3. Update user fields
      const updates: string[] = [];
      const values: unknown[] = [];
      let index = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${index++}`);
        values.push(data.name);
      }
      if (data.email !== undefined) {
        updates.push(`email = $${index++}`);
        values.push(data.email);
      }
      if (data.password !== undefined) {
        const hash = await hashPassword(data.password);
        updates.push(`password_hash = $${index++}`);
        values.push(hash);
      }
      if (data.resetMfa === true) {
        updates.push(`mfa_enabled = false, mfa_secret = NULL, last_totp_step = -1`);
      }
      if (data.disabled !== undefined) {
        updates.push(`disabled = $${index++}`);
        values.push(data.disabled);
      }

      if (updates.length > 0) {
        values.push(current.user_id);
        await client.query(
          `UPDATE identity.users SET ${updates.join(', ')} WHERE id = $${index}`,
          values
        );
      }

      // 4. Invalidate sessions if security-critical changes were made (password change, MFA reset, or account disabled)
      if (data.password !== undefined || data.resetMfa === true || data.disabled === true) {
        await client.query('DELETE FROM identity.sessions WHERE user_id = $1', [current.user_id]);
      }

      // 5. Audit event
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id, previous_role, new_role) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [principal.tenantId, principal.userId, 'membership.user_updated', correlationId, id, current.role, nextRole]
      );

      // 6. Fetch refreshed row
      const refreshed = await client.query<{
        id: string;
        user_id: string;
        email: string;
        name: string | null;
        role: Role;
        mfa_enabled: boolean;
        disabled: boolean;
        created_at: Date;
      }>(
        `SELECT m.id, m.user_id, u.email, u.name, m.role, u.mfa_enabled, u.disabled, u.created_at
         FROM identity.memberships m
         JOIN identity.users u ON u.id = m.user_id
         WHERE m.id = $1 AND m.tenant_id = $2`,
        [id, principal.tenantId]
      );
      const row = refreshed.rows[0]!;
      return adminUpdateUserResultSchema.parse({
        updated: true,
        user: {
          id: row.id,
          userId: row.user_id,
          name: row.name ?? '',
          email: row.email,
          role: row.role,
          mfaEnabled: row.mfa_enabled ?? false,
          disabled: row.disabled ?? false,
          createdAt: row.created_at.toISOString(),
        },
      });
    });
  }

  private async fetchProfile(client: PoolClient, principal: Principal, organizationName: string) {
    const user = await client.query<{ id: string; email: string; name: string | null; mfa_enabled: boolean; created_at: Date }>(
      'SELECT id, email, name, mfa_enabled, created_at FROM identity.users WHERE id = $1',
      [principal.userId]
    );
    if (!user.rows[0]) throw new AppError('USER_NOT_FOUND', 404, 'Usuario no encontrado.');
    const row = user.rows[0];
    return userProfileSchema.parse({
      id: row.id,
      email: row.email,
      name: row.name ?? '',
      role: principal.role,
      roleLabel: roleLabels[principal.role],
      capabilities: principal.capabilities,
      organization: organizationName,
      mfaEnabled: row.mfa_enabled,
      createdAt: row.created_at.toISOString(),
    });
  }

  async getProfile(principal: Principal, organizationName: string) {
    return withIdentity(this.auth.pool, principal.userId, async client => {
      return this.fetchProfile(client, principal, organizationName);
    });
  }

  async updateProfile(principal: Principal, input: UpdateProfileInput, organizationName: string, correlationId: string) {
    const data = updateProfileSchema.parse(input);
    z.uuid().parse(correlationId);
    return withIdentity(this.auth.pool, principal.userId, async client => {
      await client.query("SELECT set_config('atlas.tenant_id', $1, true)", [principal.tenantId]);
      if (data.email) {
        const existing = await client.query('SELECT 1 FROM identity.users WHERE email = $1 AND id <> $2', [data.email, principal.userId]);
        if (existing.rowCount) throw new AppError('EMAIL_ALREADY_IN_USE', 409, 'El correo electrónico ya está registrado por otro usuario.');
      }
      await client.query(
        'UPDATE identity.users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3',
        [data.name ?? null, data.email ?? null, principal.userId]
      );
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
        [principal.tenantId, principal.userId, 'user.profile_updated', correlationId, principal.userId]
      );
      return this.fetchProfile(client, principal, organizationName);
    });
  }

  async changePassword(principal: Principal, input: ChangePasswordInput, correlationId: string) {
    const data = changePasswordSchema.parse(input);
    z.uuid().parse(correlationId);
    await this.auth.rateLimit(`password-change:${principal.userId}`, 10);
    return withIdentity(this.auth.pool, principal.userId, async client => {
      await client.query("SELECT set_config('atlas.tenant_id', $1, true)", [principal.tenantId]);
      const user = await client.query<{ password_hash: string }>('SELECT password_hash FROM identity.users WHERE id = $1', [principal.userId]);
      if (!user.rows[0]) throw new AppError('USER_NOT_FOUND', 404, 'Usuario no encontrado.');
      const valid = await verifyPassword(data.currentPassword, user.rows[0].password_hash);
      if (!valid) throw new AppError('INVALID_CREDENTIALS', 401, 'La contraseña actual no es correcta.');
      const nextHash = await hashPassword(data.newPassword);
      await client.query('UPDATE identity.users SET password_hash = $1 WHERE id = $2', [nextHash, principal.userId]);
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
        [principal.tenantId, principal.userId, 'user.password_changed', correlationId, principal.userId]
      );
      return changePasswordResultSchema.parse({ updated: true });
    });
  }

  async getSelf(principal: Principal): Promise<{ name: string; email: string }> {
    return withIdentity(this.auth.pool, principal.userId, async client => {
      const user = await client.query<{ email: string; name: string | null }>(
        'SELECT email, name FROM identity.users WHERE id = $1',
        [principal.userId]
      );
      return {
        email: user.rows[0]?.email ?? '',
        name: user.rows[0]?.name ?? '',
      };
    });
  }
}
