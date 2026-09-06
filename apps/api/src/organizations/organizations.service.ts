import { z } from 'zod';
import { createPool, withTenant } from '@atlas/database';
import { accountListSchema, accountSchema, createAccountSchema, updateAccountSchema, deleteAccountResultSchema } from '@atlas/contracts';
import { requireCapability, type Principal } from '../identity/auth.service.js';
import { AppError } from '../common/errors.js';

export class OrganizationsService {
  readonly pool = createPool(process.env.DATABASE_URL);
  async onModuleDestroy() { await this.pool.end(); }
  async name(principal: Principal) {
    return withTenant(this.pool, principal.tenantId, async client => {
      const result = await client.query('SELECT name FROM organizations WHERE id = $1', [principal.tenantId]);
      if (!result.rows[0]) throw new AppError('ORGANIZATION_UNAVAILABLE', 403, 'Tu organización no está disponible.');
      return z.object({ name: z.string() }).parse(result.rows[0]).name;
    });
  }
  async accounts(principal: Principal) {
    return withTenant(this.pool, principal.tenantId, async client => {
      const result = await client.query('SELECT id, name, timezone FROM accounts ORDER BY name LIMIT 100');
      return accountListSchema.parse({ items: result.rows });
    });
  }
  async account(principal: Principal, id: string) {
    z.uuid().parse(id);
    return withTenant(this.pool, principal.tenantId, async client => {
      const result = await client.query('SELECT id,name,timezone FROM accounts WHERE id = $1', [id]);
      if (!result.rows[0]) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Cuenta no encontrada.');
      return accountSchema.parse(result.rows[0]);
    });
  }
  async createAccount(principal: Principal, input: z.infer<typeof createAccountSchema>, creationKey: string, correlationId: string) {
    requireCapability(principal, 'tenant.manage');
    createAccountSchema.parse(input); z.uuid().parse(creationKey); z.uuid().parse(correlationId);
    try {
      return await withTenant(this.pool, principal.tenantId, async client => {
        const created = await client.query(`INSERT INTO accounts(tenant_id,name,timezone,creation_key) VALUES ($1,$2,$3,$4)
          ON CONFLICT (tenant_id,creation_key) DO NOTHING RETURNING id,name,timezone`, [principal.tenantId, input.name, input.timezone, creationKey]);
        if (created.rows[0]) {
          const account = accountSchema.parse(created.rows[0]);
          await client.query('INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id,target_id) VALUES ($1,$2,$3,$4,$5)', [principal.tenantId, principal.userId, 'account.created', correlationId, account.id]);
          return account;
        }
        const previous = await client.query('SELECT id,name,timezone FROM accounts WHERE creation_key = $1', [creationKey]);
        const account = accountSchema.parse(previous.rows[0]);
        if (account.name !== input.name || account.timezone !== input.timezone) throw new AppError('IDEMPOTENCY_CONFLICT', 409, 'La solicitud ya fue utilizada con otros datos.');
        return account;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new AppError('ACCOUNT_NAME_EXISTS', 409, 'Ya existe una cuenta con ese nombre en tu organización.');
      throw error;
    }
  }

  async updateAccount(principal: Principal, id: string, input: z.infer<typeof updateAccountSchema>, correlationId: string) {
    requireCapability(principal, 'tenant.manage');
    z.uuid().parse(id);
    const data = updateAccountSchema.parse(input);
    z.uuid().parse(correlationId);
    try {
      return await withTenant(this.pool, principal.tenantId, async client => {
        const target = await client.query<{ id: string; name: string; timezone: string }>(
          'SELECT id, name, timezone FROM accounts WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
          [id, principal.tenantId]
        );
        if (!target.rows[0]) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Cuenta no encontrada.');
        if (data.name && data.name !== target.rows[0].name) {
          const duplicate = await client.query('SELECT 1 FROM accounts WHERE tenant_id = $1 AND name = $2 AND id <> $3', [principal.tenantId, data.name, id]);
          if (duplicate.rowCount) throw new AppError('ACCOUNT_NAME_EXISTS', 409, 'Ya existe una cuenta con ese nombre en tu organización.');
        }
        const updated = await client.query<{ id: string; name: string; timezone: string }>(
          'UPDATE accounts SET name = COALESCE($1, name), timezone = COALESCE($2, timezone) WHERE id = $3 AND tenant_id = $4 RETURNING id, name, timezone',
          [data.name ?? null, data.timezone ?? null, id, principal.tenantId]
        );
        await client.query(
          'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
          [principal.tenantId, principal.userId, 'account.updated', correlationId, id]
        );
        return accountSchema.parse(updated.rows[0]);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new AppError('ACCOUNT_NAME_EXISTS', 409, 'Ya existe una cuenta con ese nombre en tu organización.');
      }
      throw error;
    }
  }

  async deleteAccount(principal: Principal, id: string, correlationId: string) {
    requireCapability(principal, 'tenant.manage');
    z.uuid().parse(id);
    z.uuid().parse(correlationId);
    return withTenant(this.pool, principal.tenantId, async client => {
      const target = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM accounts WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, principal.tenantId]
      );
      if (!target.rows[0]) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Cuenta no encontrada.');
      // Unlink any teams that reference this account in workforce
      await client.query('UPDATE teams SET account_id = NULL WHERE account_id = $1 AND tenant_id = $2', [id, principal.tenantId]);
      await client.query('DELETE FROM accounts WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
        [principal.tenantId, principal.userId, 'account.deleted', correlationId, id]
      );
      return deleteAccountResultSchema.parse({ deleted: true });
    });
  }
}
