import { z } from 'zod';
import { createPool, withTenant, type PoolClient, type Pool } from '@atlas/database';
import {
  DomainError,
  dashboardCreateSchema,
  dashboardVersionCreateSchema,
  dashboardSchema,
  dashboardVersionSchema,
  dashboardListSchema,
  dashboardFilterOptionsSchema,
  type DashboardFilterOptions,
  type DataActor,
} from '@atlas/contracts';
import { permit, audit } from '@atlas/ingestion';

const dashSelect = `SELECT id, name, slug, description, current_version_id AS "currentVersionId", created_at::text AS "createdAt" FROM dashboards`;
const verSelect = `SELECT id, dashboard_id AS "dashboardId", number, title, description, layout, global_filters AS "globalFilters", published_at::text AS "publishedAt", created_at::text AS "createdAt" FROM dashboard_versions`;

export class DashboardsService {
  readonly pool: Pool = createPool(process.env.DATABASE_URL);

  async onModuleDestroy() {
    await this.pool.end();
  }

  async list(actor: DataActor) {
    permit(actor, 'dashboard.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      const isManager = actor.capabilities.includes('dashboard.manage');
      const condition = isManager ? '' : 'WHERE current_version_id IS NOT NULL';
      const dashboards = (await client.query(`${dashSelect} ${condition} ORDER BY created_at DESC LIMIT 100`)).rows;

      const items = await Promise.all(
        dashboards.map(async d => {
          let currentVersion = null;
          if (d.currentVersionId) {
            const verRow = (await client.query(`${verSelect} WHERE id = $1`, [d.currentVersionId])).rows[0];
            if (verRow) currentVersion = dashboardVersionSchema.parse(verRow);
          }
          return dashboardSchema.parse({ ...d, currentVersion });
        })
      );

      return dashboardListSchema.parse({ items });
    });
  }

  private async getVersion(client: PoolClient, versionId: string) {
    const row = (await client.query(`${verSelect} WHERE id = $1`, [z.uuid().parse(versionId)])).rows[0];
    if (!row) throw new DomainError('DASHBOARD_VERSION_NOT_FOUND', 404, 'Versión de dashboard no encontrada.');
    return dashboardVersionSchema.parse(row);
  }

  private async getInternal(client: PoolClient, actor: DataActor, id: string) {
    z.uuid().parse(id);
    const row = (await client.query(`${dashSelect} WHERE id = $1`, [id])).rows[0];
    if (!row) throw new DomainError('DASHBOARD_NOT_FOUND', 404, 'Dashboard no encontrado.');

    const isManager = actor.capabilities.includes('dashboard.manage');
    let targetVersionId = row.currentVersionId;

    if (isManager && !targetVersionId) {
      const latestVer = (await client.query<{ id: string }>(
        'SELECT id FROM dashboard_versions WHERE dashboard_id = $1 ORDER BY number DESC LIMIT 1',
        [id]
      )).rows[0];
      targetVersionId = latestVer?.id ?? null;
    }

    if (!targetVersionId && !isManager) {
      throw new DomainError('DASHBOARD_NOT_FOUND', 404, 'Dashboard no publicado.');
    }

    let currentVersion = null;
    if (targetVersionId) {
      currentVersion = await this.getVersion(client, targetVersionId);
    }

    return dashboardSchema.parse({ ...row, currentVersion });
  }

  async get(actor: DataActor, id: string) {
    permit(actor, 'dashboard.read');
    return withTenant(this.pool, actor.tenantId, client => this.getInternal(client, actor, id));
  }

  async create(actor: DataActor, body: unknown, key: string, correlationId: string) {
    permit(actor, 'dashboard.manage');
    const input = dashboardCreateSchema.parse(body);
    z.uuid().parse(key);

    return withTenant(this.pool, actor.tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor.tenantId}:${input.slug}`]);
      const existing = (await client.query(`${dashSelect} WHERE creation_key = $1`, [key])).rows[0];
      if (existing) {
        return this.getInternal(client, actor, existing.id);
      }

      const dashRes = await client.query<{ id: string }>(
        `INSERT INTO dashboards (tenant_id, name, slug, description, creation_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [actor.tenantId, input.name, input.slug, input.description, key]
      );
      const dashboardId = dashRes.rows[0]!.id;

      // Create initial draft version v1
      const initialVerKey = crypto.randomUUID();
      await client.query(
        `INSERT INTO dashboard_versions (
          tenant_id, dashboard_id, number, title, description, layout, global_filters, actor_id, creation_key
        ) VALUES ($1, $2, 1, $3, $4, '[]'::jsonb, '{}'::jsonb, $5, $6)`,
        [actor.tenantId, dashboardId, input.name, input.description, actor.userId, initialVerKey]
      );

      await audit(client, actor, 'dashboard.created', dashboardId, correlationId);
      return this.getInternal(client, actor, dashboardId);
    });
  }

  async saveVersion(actor: DataActor, dashboardId: string, body: unknown, key: string, correlationId: string) {
    permit(actor, 'dashboard.manage');
    z.uuid().parse(dashboardId);
    z.uuid().parse(key);
    const input = dashboardVersionCreateSchema.parse(body);

    return withTenant(this.pool, actor.tenantId, async client => {
      const dash = (await client.query(`${dashSelect} WHERE id = $1`, [dashboardId])).rows[0];
      if (!dash) throw new DomainError('DASHBOARD_NOT_FOUND', 404, 'Dashboard no encontrado.');

      const existing = (await client.query(`${verSelect} WHERE creation_key = $1`, [key])).rows[0];
      if (existing) return dashboardVersionSchema.parse(existing);

      const nextNumberRes = await client.query<{ num: number }>(
        'SELECT COALESCE(MAX(number), 0) + 1 AS num FROM dashboard_versions WHERE dashboard_id = $1',
        [dashboardId]
      );
      const nextNumber = nextNumberRes.rows[0]!.num;

      const verRes = await client.query<{ id: string }>(
        `INSERT INTO dashboard_versions (
          tenant_id, dashboard_id, number, title, description, layout, global_filters, actor_id, creation_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          actor.tenantId, dashboardId, nextNumber, input.title, input.description,
          JSON.stringify(input.layout), JSON.stringify(input.globalFilters),
          actor.userId, key
        ]
      );
      const verId = verRes.rows[0]!.id;

      await audit(client, actor, 'dashboard.version_saved', verId, correlationId);
      return this.getVersion(client, verId);
    });
  }

  async publish(actor: DataActor, dashboardId: string, versionId: string, key: string, correlationId: string) {
    permit(actor, 'dashboard.publish');
    z.uuid().parse(dashboardId);
    z.uuid().parse(versionId);
    z.uuid().parse(key);

    return withTenant(this.pool, actor.tenantId, async client => {
      const dash = (await client.query(`${dashSelect} WHERE id = $1 FOR UPDATE`, [dashboardId])).rows[0];
      if (!dash) throw new DomainError('DASHBOARD_NOT_FOUND', 404, 'Dashboard no encontrado.');

      const ver = (await client.query(`${verSelect} WHERE id = $1 AND dashboard_id = $2`, [versionId, dashboardId])).rows[0];
      if (!ver) throw new DomainError('DASHBOARD_VERSION_NOT_FOUND', 404, 'Versión de dashboard no encontrada.');

      // Mark version published if not already
      if (!ver.publishedAt) {
        await client.query('UPDATE dashboard_versions SET published_at = now() WHERE id = $1', [versionId]);
      }

      // Record publication
      await client.query(
        `INSERT INTO dashboard_publications (tenant_id, dashboard_id, version_id, actor_id, creation_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, dashboard_id, creation_key) DO NOTHING`,
        [actor.tenantId, dashboardId, versionId, actor.userId, key]
      );

      // Point dashboard to published version
      await client.query('UPDATE dashboards SET current_version_id = $1 WHERE id = $2', [versionId, dashboardId]);

      await audit(client, actor, 'dashboard.published', dashboardId, correlationId);
      return this.getInternal(client, actor, dashboardId);
    });
  }

  async getFilterOptions(actor: DataActor, dashboardId: string): Promise<DashboardFilterOptions> {
    permit(actor, 'dashboard.read');
    z.uuid().parse(dashboardId);

    return withTenant(this.pool, actor.tenantId, async client => {
      const dashboard = await this.getInternal(client, actor, dashboardId);
      const layout = dashboard.currentVersion?.layout || [];

      const kpiVersionIds = layout
        .map(w => w.kpiVersionId)
        .filter((id): id is string => Boolean(id));

      const supervisors = new Set<string>();
      const fms = new Set<string>();
      const waves = new Set<string>();
      const dateFields = new Set<string>();

      if (kpiVersionIds.length > 0) {
        const kpiRows = (await client.query<{ dataset_version_id: string }>(
          'SELECT dataset_version_id FROM kpi_versions WHERE id = ANY($1)',
          [kpiVersionIds]
        )).rows;

        const datasetVersionIds = Array.from(new Set(kpiRows.map(r => r.dataset_version_id)));

        for (const verId of datasetVersionIds) {
          const verRow = (await client.query<{ mapping: any }>(
            'SELECT mapping FROM dataset_versions WHERE id = $1',
            [verId]
          )).rows[0];

          if (!verRow?.mapping?.fields) continue;
          const fields: Array<{ target: string; type: string }> = verRow.mapping.fields;

          // Detect date fields
          for (const f of fields) {
            if (f.type === 'date' || f.type === 'datetime' || /fecha|date|timestamp|dia|day|periodo/i.test(f.target)) {
              dateFields.add(f.target);
            }
          }

          // Detect supervisor field
          const supField = fields.find(f => /^(supervisor|sup|team_leader|tl|supervisor_name)$/i.test(f.target));
          if (supField) {
            const rows = (await client.query<{ val: string }>(
              `SELECT DISTINCT (values->>$1)::text AS val
               FROM dataset_rows
               WHERE version_id = $2 AND values->>$1 IS NOT NULL AND TRIM(values->>$1) != ''
               ORDER BY val ASC LIMIT 100`,
              [supField.target, verId]
            )).rows;
            for (const r of rows) if (r.val) supervisors.add(r.val);
          }

          // Detect FM field
          const fmField = fields.find(f => /^(fm|floor_manager|jefe_piso|floor_mgr)$/i.test(f.target));
          if (fmField) {
            const rows = (await client.query<{ val: string }>(
              `SELECT DISTINCT (values->>$1)::text AS val
               FROM dataset_rows
               WHERE version_id = $2 AND values->>$1 IS NOT NULL AND TRIM(values->>$1) != ''
               ORDER BY val ASC LIMIT 100`,
              [fmField.target, verId]
            )).rows;
            for (const r of rows) if (r.val) fms.add(r.val);
          }

          // Detect wave field
          const waveField = fields.find(f => /^(wave|ola|cohorte|grupo_wave)$/i.test(f.target));
          if (waveField) {
            const rows = (await client.query<{ val: string }>(
              `SELECT DISTINCT (values->>$1)::text AS val
               FROM dataset_rows
               WHERE version_id = $2 AND values->>$1 IS NOT NULL AND TRIM(values->>$1) != ''
               ORDER BY val ASC LIMIT 100`,
              [waveField.target, verId]
            )).rows;
            for (const r of rows) if (r.val) waves.add(r.val);
          }
        }
      }

      // Supplement with workforce employees if available
      try {
        const wfEmployees = (await client.query<{ name: string; type_slug: string }>(
          `SELECT (e.first_name || ' ' || e.last_name) AS name, et.slug AS type_slug
           FROM employees e
           LEFT JOIN employee_types et ON et.id = e.employee_type_id
           WHERE e.tenant_id = $1 LIMIT 200`,
          [actor.tenantId]
        )).rows;

        for (const emp of wfEmployees) {
          if (/sup/i.test(emp.type_slug || '')) supervisors.add(emp.name);
          if (/fm|floor/i.test(emp.type_slug || '')) fms.add(emp.name);
        }
      } catch {}

      return dashboardFilterOptionsSchema.parse({
        supervisors: Array.from(supervisors).sort((a, b) => a.localeCompare(b)),
        fms: Array.from(fms).sort((a, b) => a.localeCompare(b)),
        waves: Array.from(waves).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        dateFields: Array.from(dateFields).sort(),
      });
    });
  }
}
