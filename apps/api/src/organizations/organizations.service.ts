/**
 * @file apps/api/src/organizations/organizations.service.ts
 * @description Servicio de administración de organizaciones y cuentas operacionales (campañas/clientes de call center).
 * Proporciona endpoints para consultar el nombre de la organización del tenant, listar cuentas,
 * crear nuevas cuentas con zona horaria específica (idempotencia y validación de unicidad),
 * actualizar cuentas existentes y realizar borrado seguro con auditoría completa.
 */

import { z } from 'zod';
import { createPool, withTenant } from '@atlas/database';
import { accountListSchema, accountSchema, createAccountSchema, updateAccountSchema, deleteAccountResultSchema } from '@atlas/contracts';
import { requireCapability, type Principal } from '../identity/auth.service.js';
import { AppError } from '../common/errors.js';

/**
 * Servicio de gestión de tenants, organizaciones y cuentas operacionales.
 */
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
      const isAdmin = principal.role === 'admin';
      const query = isAdmin
        ? `SELECT a.id, a.name, a.timezone, a.archived_at::text AS "archivedAt",
                  COALESCE((SELECT count(*)::int FROM datasets d WHERE d.tenant_id = a.tenant_id AND d.account_id = a.id AND d.archived_at IS NULL), 0) AS "datasetCount",
                  COALESCE((SELECT count(DISTINCT slug)::int FROM kpi_versions k WHERE k.tenant_id = a.tenant_id AND k.account_id = a.id AND k.deprecated_at IS NULL), 0) AS "kpiCount",
                  COALESCE((SELECT count(*)::int FROM dashboards b WHERE b.tenant_id = a.tenant_id AND b.account_id = a.id), 0) AS "dashboardCount",
                  COALESCE((SELECT count(*)::int FROM identity.membership_account_access maa WHERE maa.tenant_id = a.tenant_id AND maa.account_id = a.id), 0) AS "memberCount",
                  (SELECT week_code FROM workforce_weeks w WHERE w.tenant_id = a.tenant_id AND w.account_id = a.id AND w.status = 'current' LIMIT 1) AS "activeWeekCode",
                  (SELECT status FROM workforce_roster_versions r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id ORDER BY r.created_at DESC LIMIT 1) AS "rosterStatus"
           FROM accounts a
           WHERE a.tenant_id = $1
           ORDER BY a.archived_at NULLS FIRST, a.name
           LIMIT 100`
        : `SELECT a.id, a.name, a.timezone, a.archived_at::text AS "archivedAt",
                  COALESCE((SELECT count(*)::int FROM datasets d WHERE d.tenant_id = a.tenant_id AND d.account_id = a.id AND d.archived_at IS NULL), 0) AS "datasetCount",
                  COALESCE((SELECT count(DISTINCT slug)::int FROM kpi_versions k WHERE k.tenant_id = a.tenant_id AND k.account_id = a.id AND k.deprecated_at IS NULL), 0) AS "kpiCount",
                  COALESCE((SELECT count(*)::int FROM dashboards b WHERE b.tenant_id = a.tenant_id AND b.account_id = a.id), 0) AS "dashboardCount",
                  COALESCE((SELECT count(*)::int FROM identity.membership_account_access maa WHERE maa.tenant_id = a.tenant_id AND maa.account_id = a.id), 0) AS "memberCount",
                  (SELECT week_code FROM workforce_weeks w WHERE w.tenant_id = a.tenant_id AND w.account_id = a.id AND w.status = 'current' LIMIT 1) AS "activeWeekCode",
                  (SELECT status FROM workforce_roster_versions r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id ORDER BY r.created_at DESC LIMIT 1) AS "rosterStatus"
           FROM accounts a
           JOIN identity.membership_account_access maa ON maa.account_id = a.id AND maa.tenant_id = a.tenant_id
           JOIN identity.memberships m ON m.id = maa.membership_id AND m.user_id = $2
           WHERE a.tenant_id = $1 AND a.archived_at IS NULL
           ORDER BY a.name
           LIMIT 100`;

      const params = isAdmin ? [principal.tenantId] : [principal.tenantId, principal.userId];
      const result = await client.query(query, params);
      return accountListSchema.parse({ items: result.rows });
    });
  }
  async account(principal: Principal, id: string) {
    z.uuid().parse(id);
    return withTenant(this.pool, principal.tenantId, async client => {
      const result = await client.query('SELECT id, name, timezone, archived_at::text AS "archivedAt" FROM accounts WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
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
          ON CONFLICT (tenant_id,creation_key) DO NOTHING RETURNING id,name,timezone,archived_at::text AS "archivedAt"`, [principal.tenantId, input.name, input.timezone, creationKey]);
        if (created.rows[0]) {
          const account = accountSchema.parse(created.rows[0]);
          await client.query('INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id,target_id) VALUES ($1,$2,$3,$4,$5)', [principal.tenantId, principal.userId, 'account.created', correlationId, account.id]);
          return account;
        }
        const previous = await client.query('SELECT id,name,timezone,archived_at::text AS "archivedAt" FROM accounts WHERE creation_key = $1', [creationKey]);
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
        const updated = await client.query<{ id: string; name: string; timezone: string; archived_at: Date | null }>(
          'UPDATE accounts SET name = COALESCE($1, name), timezone = COALESCE($2, timezone) WHERE id = $3 AND tenant_id = $4 RETURNING id, name, timezone, archived_at::text AS "archivedAt"',
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

      // Verificar deterministamente si la cuenta posee recursos o datos asociados que requieran preservación histórica
      const guardCheck = await client.query<{ hasData: boolean }>(`
        SELECT (
          EXISTS (SELECT 1 FROM datasets WHERE account_id = $1 AND tenant_id = $2) OR
          EXISTS (SELECT 1 FROM kpi_versions WHERE account_id = $1 AND tenant_id = $2) OR
          EXISTS (SELECT 1 FROM dashboards WHERE account_id = $1 AND tenant_id = $2) OR
          EXISTS (SELECT 1 FROM workforce_weeks WHERE account_id = $1 AND tenant_id = $2) OR
          EXISTS (SELECT 1 FROM employees WHERE account_id = $1 AND tenant_id = $2)
        ) AS "hasData"
      `, [id, principal.tenantId]);

      if (guardCheck.rows[0]?.hasData) {
        // La cuenta posee datos asociados: procedemos directamente al archivo lógico sin provocar error 23514
        await client.query('UPDATE accounts SET archived_at = now() WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
        await client.query(
          'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
          [principal.tenantId, principal.userId, 'account.archived', correlationId, id]
        );
        return deleteAccountResultSchema.parse({ archived: true });
      }

      // La cuenta no posee datos: borrado físico definitivo protegido mediante SAVEPOINT
      await client.query('SAVEPOINT account_delete_attempt');
      try {
        await client.query('DELETE FROM accounts WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
        await client.query('RELEASE SAVEPOINT account_delete_attempt');
        await client.query(
          'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
          [principal.tenantId, principal.userId, 'account.deleted', correlationId, id]
        );
        return deleteAccountResultSchema.parse({ deleted: true });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23514') {
          await client.query('ROLLBACK TO SAVEPOINT account_delete_attempt');
          await client.query('UPDATE accounts SET archived_at = now() WHERE id = $1 AND tenant_id = $2', [id, principal.tenantId]);
          await client.query(
            'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
            [principal.tenantId, principal.userId, 'account.archived', correlationId, id]
          );
          return deleteAccountResultSchema.parse({ archived: true });
        }
        throw error;
      }
    });
  }

  async unarchiveAccount(principal: Principal, id: string, correlationId: string) {
    requireCapability(principal, 'tenant.manage');
    z.uuid().parse(id);
    z.uuid().parse(correlationId);
    return withTenant(this.pool, principal.tenantId, async client => {
      const updated = await client.query(
        'UPDATE accounts SET archived_at = NULL WHERE id = $1 AND tenant_id = $2 RETURNING id, name, timezone, archived_at::text AS "archivedAt"',
        [id, principal.tenantId]
      );
      if (!updated.rows[0]) throw new AppError('ACCOUNT_NOT_FOUND', 404, 'Cuenta no encontrada.');
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
        [principal.tenantId, principal.userId, 'account.unarchived', correlationId, id]
      );
      return accountSchema.parse(updated.rows[0]);
    });
  }

  async getAccountMembers(principal: Principal, accountId: string) {
    requireCapability(principal, 'tenant.manage');
    z.uuid().parse(accountId);
    return withTenant(this.pool, principal.tenantId, async client => {
      const result = await client.query<{ membership_id: string }>(
        'SELECT membership_id FROM identity.membership_account_access WHERE account_id = $1 AND tenant_id = $2',
        [accountId, principal.tenantId]
      );
      return { membershipIds: result.rows.map(r => r.membership_id) };
    });
  }

  async setAccountMembers(principal: Principal, accountId: string, membershipIds: string[], correlationId: string) {
    requireCapability(principal, 'tenant.manage');
    z.uuid().parse(accountId);
    z.uuid().parse(correlationId);
    membershipIds.forEach(id => z.uuid().parse(id));
    return withTenant(this.pool, principal.tenantId, async client => {
      await client.query('DELETE FROM identity.membership_account_access WHERE account_id = $1 AND tenant_id = $2', [accountId, principal.tenantId]);
      for (const mId of membershipIds) {
        await client.query(
          'INSERT INTO identity.membership_account_access (tenant_id, membership_id, account_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [principal.tenantId, mId, accountId]
        );
      }
      await client.query(
        'INSERT INTO audit_events(tenant_id, actor_id, event, correlation_id, target_id) VALUES ($1, $2, $3, $4, $5)',
        [principal.tenantId, principal.userId, 'account.members_updated', correlationId, accountId]
      );
      return { ok: true };
    });
  }
}
