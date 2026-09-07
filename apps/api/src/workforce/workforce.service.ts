/**
 * @file apps/api/src/workforce/workforce.service.ts
 * @description Servicio transaccional de Workforce / Agent Definer en ATLAS (@atlas/api).
 * Modela el catálogo integral del personal operativo de call center exclusivo por cuenta:
 * - Semanas operativas lunes-domingo (`workforce_weeks`, formato ISO YYYY-Www).
 * - Tipos de contrato y roles laborales (`employee_types`).
 * - Empleados (código único de agente, BMS ID, Wave, metadatos JSONB).
 * - Equipos de trabajo (`teams`) y asignaciones temporales con vigencia (`valid_from`, `valid_to`).
 * - Jerarquías de supervisión y mentoría (`employee_relationships`).
 * - Rosters congelados e inmutables por semana (`workforce_roster_versions`, `workforce_roster_entries`).
 * - Importador masivo de Rosters Excel con reconciliación automática multi-hoja y clonación entre semanas.
 */

import { z } from 'zod';
import { createPool, withTenant, withAccount, type PoolClient, type Pool } from '@atlas/database';
import {
  DomainError,
  employeeTypeSchema,
  employeeTypeCreateSchema,
  employeeTypeListSchema,
  teamSchema,
  teamCreateSchema,
  teamListSchema,
  employeeSchema,
  employeeCreateSchema,
  employeeListSchema,
  employmentAssignmentSchema,
  employmentAssignmentCreateSchema,
  employmentAssignmentListSchema,
  employeeRelationshipSchema,
  employeeRelationshipCreateSchema,
  employeeRelationshipListSchema,
  workforceWeekSchema,
  workforceWeekCreateSchema,
  workforceWeekUpdateSchema,
  workforceWeekListSchema,
  teamRosterImportInputSchema,
  teamRosterImportResultSchema,
  type TeamRosterImportResult,
  type DataActor,
} from '@atlas/contracts';
import { permit, audit } from '@atlas/ingestion';
import { parseRosterFile, generateTeamTemplateXlsx } from './excel-roster.js';

/**
 * Convierte un nombre arbitrario de equipo en un slug SQL compatible en minúsculas y sin acentos.
 */
function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s || !/^[a-z]/.test(s)) {
    s = `team_${s || 'general'}`;
  }
  return s.slice(0, 60);
}

/**
 * Ejecuta una transacción en PostgreSQL estableciendo tanto tenant_id como account_id si está presente.
 */
function execute<T>(pool: Pool, actor: DataActor, action: (client: PoolClient) => Promise<T>): Promise<T> {
  if (actor.accountId) {
    return withAccount(pool, actor.tenantId, actor.accountId, action);
  }
  return withTenant(pool, actor.tenantId, action);
}

/**
 * Servicio central para la gestión del personal operativo, equipos, jerarquías y semanas operativas.
 */
export class WorkforceService {
  readonly pool: Pool = createPool(process.env.DATABASE_URL);

  async onModuleDestroy() {
    await this.pool.end();
  }

  // --- Workforce Weeks ---

  async listWeeks(actor: DataActor, options: { yearNumber?: number | undefined; status?: string | undefined } = {}) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      let query = `
        SELECT id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
               start_date::text AS "startDate", end_date::text AS "endDate", status,
               COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"
        FROM workforce_weeks
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options.yearNumber) {
        params.push(options.yearNumber);
        conditions.push(`year_number = $${params.length}`);
      }
      if (options.status) {
        params.push(options.status);
        conditions.push(`status = $${params.length}`);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      query += ` ORDER BY year_number DESC, week_number DESC LIMIT 200`;

      const rows = (await client.query(query, params)).rows;
      return workforceWeekListSchema.parse({ items: rows });
    });
  }

  async getCurrentWeek(actor: DataActor) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      const row = (await client.query(
        `SELECT id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
                start_date::text AS "startDate", end_date::text AS "endDate", status,
                COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"
         FROM workforce_weeks
         WHERE status = 'current'
         LIMIT 1`
      )).rows[0];
      return row ? workforceWeekSchema.parse(row) : null;
    });
  }

  async createWeek(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para registrar semanas operativas.');
    const input = workforceWeekCreateSchema.parse(body);

    return execute(this.pool, actor, async client => {
      const existing = (await client.query(
        `SELECT id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
                start_date::text AS "startDate", end_date::text AS "endDate", status,
                COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"
         FROM workforce_weeks WHERE week_code = $1 AND account_id = $2`,
        [input.weekCode, actor.accountId]
      )).rows[0];
      if (existing) return workforceWeekSchema.parse(existing);

      let endDate = input.endDate;
      if (!endDate) {
        const d = new Date(input.startDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 6);
        endDate = d.toISOString().split('T')[0]!;
      }

      if (input.status === 'current') {
        await client.query(`UPDATE workforce_weeks SET status = 'open' WHERE status = 'current' AND account_id = $1`, [actor.accountId]);
      }

      const result = await client.query(
        `INSERT INTO workforce_weeks(tenant_id, account_id, week_code, year_number, week_number, start_date, end_date, status, custom_attributes)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)
         RETURNING id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
                   start_date::text AS "startDate", end_date::text AS "endDate", status,
                   COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"`,
        [
          actor.tenantId,
          actor.accountId,
          input.weekCode,
          input.yearNumber,
          input.weekNumber,
          input.startDate,
          endDate,
          input.status,
          JSON.stringify(input.customAttributes ?? {}),
        ]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.week_created', row.id, correlation);
      return workforceWeekSchema.parse(row);
    });
  }

  async updateWeek(actor: DataActor, id: string, body: unknown, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = workforceWeekUpdateSchema.parse(body);
    const weekId = z.uuid().parse(id);

    return execute(this.pool, actor, async client => {
      const current = (await client.query('SELECT id, status, custom_attributes FROM workforce_weeks WHERE id = $1', [weekId])).rows[0];
      if (!current) throw new DomainError('WEEK_NOT_FOUND', 404, 'Semana operativa no encontrada.');

      if (input.status === 'current') {
        await client.query(`UPDATE workforce_weeks SET status = 'open' WHERE status = 'current' AND id <> $1`, [weekId]);
      }

      const newStatus = input.status ?? current.status;
      const newAttrs = input.customAttributes ? { ...current.custom_attributes, ...input.customAttributes } : current.custom_attributes;

      const result = await client.query(
        `UPDATE workforce_weeks
         SET status = $1, custom_attributes = $2
         WHERE id = $3
         RETURNING id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
                   start_date::text AS "startDate", end_date::text AS "endDate", status,
                   COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"`,
        [newStatus, JSON.stringify(newAttrs), weekId]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.week_updated', row.id, correlation);
      return workforceWeekSchema.parse(row);
    });
  }

  async generateYearWeeks(actor: DataActor, year: number, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para generar semanas.');
    return execute(this.pool, actor, async client => {
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const day = jan4.getUTCDay() || 7;
      const mondayWeek1 = new Date(jan4.getTime() - (day - 1) * 86400000);

      const generatedWeeks: Array<{ weekCode: string; yearNumber: number; weekNumber: number; startDate: string; endDate: string }> = [];
      const currentMonday = new Date(mondayWeek1.getTime());

      for (let w = 1; w <= 53; w++) {
        const sunday = new Date(currentMonday.getTime() + 6 * 86400000);
        const thursday = new Date(currentMonday.getTime() + 3 * 86400000);
        if (w > 52 && thursday.getUTCFullYear() > year) break;

        const weekStr = String(w).padStart(2, '0');
        const weekCode = `${year}-W${weekStr}`;
        const startDate = currentMonday.toISOString().split('T')[0]!;
        const endDate = sunday.toISOString().split('T')[0]!;

        generatedWeeks.push({
          weekCode,
          yearNumber: year,
          weekNumber: w,
          startDate,
          endDate,
        });

        currentMonday.setUTCDate(currentMonday.getUTCDate() + 7);
      }

      for (const wk of generatedWeeks) {
        await client.query(
          `INSERT INTO workforce_weeks(tenant_id, account_id, week_code, year_number, week_number, start_date, end_date, status, custom_attributes)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, 'open', '{}'::jsonb)
           ON CONFLICT (tenant_id, account_id, week_code) DO NOTHING`,
          [actor.tenantId, actor.accountId, wk.weekCode, wk.yearNumber, wk.weekNumber, wk.startDate, wk.endDate]
        );
      }

      await audit(client, actor, 'workforce.year_weeks_generated', actor.tenantId, correlation);
      const rows = (await client.query(
        `SELECT id, account_id AS "accountId", week_code AS "weekCode", year_number AS "yearNumber", week_number AS "weekNumber",
                start_date::text AS "startDate", end_date::text AS "endDate", status,
                COALESCE(custom_attributes, '{}'::jsonb) AS "customAttributes", created_at::text AS "createdAt"
         FROM workforce_weeks
         WHERE year_number = $1
         ORDER BY week_number ASC`,
        [year]
      )).rows;

      return workforceWeekListSchema.parse({ items: rows });
    });
  }

  // --- Employee Types ---

  async listEmployeeTypes(actor: DataActor) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"
         FROM employee_types
         ORDER BY name ASC`
      )).rows;
      return employeeTypeListSchema.parse({ items: rows });
    });
  }

  async createEmployeeType(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para crear roles laborales.');
    const input = employeeTypeCreateSchema.parse(body);
    return execute(this.pool, actor, async client => {
      const existing = (await client.query(
        `SELECT id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"
         FROM employee_types WHERE slug = $1 AND account_id = $2`,
        [input.slug, actor.accountId]
      )).rows[0];
      if (existing) return employeeTypeSchema.parse(existing);

      const result = await client.query(
        `INSERT INTO employee_types(tenant_id, account_id, name, slug, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"`,
        [actor.tenantId, actor.accountId, input.name, input.slug, input.description]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.employee_type_created', row.id, correlation);
      return employeeTypeSchema.parse(row);
    });
  }

  // --- Teams ---

  async listTeams(actor: DataActor) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"
         FROM teams
         ORDER BY name ASC`
      )).rows;
      return teamListSchema.parse({ items: rows });
    });
  }

  async createTeam(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = teamCreateSchema.parse(body);
    const accountId = actor.accountId || input.accountId;
    if (!accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para registrar equipos.');

    return execute(this.pool, actor, async client => {
      const existing = (await client.query(
        `SELECT id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"
         FROM teams WHERE slug = $1 AND account_id = $2`,
        [input.slug, accountId]
      )).rows[0];
      if (existing) return teamSchema.parse(existing);

      const result = await client.query(
        `INSERT INTO teams(tenant_id, account_id, name, slug, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"`,
        [actor.tenantId, accountId, input.name, input.slug, input.description]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.team_created', row.id, correlation);
      return teamSchema.parse(row);
    });
  }

  async getTeamTemplate(actor: DataActor): Promise<Buffer> {
    permit(actor, 'workforce.read');
    return generateTeamTemplateXlsx();
  }

  async importTeamsFromExcel(actor: DataActor, body: unknown, correlation: string): Promise<TeamRosterImportResult> {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para importar personal.');
    const input = teamRosterImportInputSchema.parse(body);

    const buffer = Buffer.from(input.base64Content, 'base64');
    const rows = await parseRosterFile(buffer, input.filename);

    return execute(this.pool, actor, async client => {
      interface TeamImportEntry {
        id?: string | undefined;
        name: string;
        slug: string;
        isNew: boolean;
        membersCount: number;
      }
      const teamMap = new Map<string, TeamImportEntry>();

      const existingTeams = (await client.query('SELECT id, name, slug FROM teams WHERE account_id = $1', [actor.accountId])).rows;
      const existingTeamsBySlug = new Map<string, { id: string; name: string; slug: string }>();
      const existingTeamsByName = new Map<string, { id: string; name: string; slug: string }>();
      for (const t of existingTeams) {
        existingTeamsBySlug.set(t.slug, t);
        existingTeamsByName.set(t.name.toLowerCase().trim(), t);
      }

      for (const r of rows) {
        const tName = r.teamName.trim();
        const normName = tName.toLowerCase();
        let teamEntry = teamMap.get(normName);
        if (!teamEntry) {
          const existing = existingTeamsByName.get(normName);
          const slug = existing ? existing.slug : slugify(tName);
          teamEntry = {
            id: existing ? (existing.id as string) : undefined,
            name: existing ? existing.name : tName,
            slug,
            isNew: !existing,
            membersCount: 0,
          };
          teamMap.set(normName, teamEntry);
        }
        if (r.employeeCode) {
          teamEntry.membersCount++;
        }
      }

      const warnings: string[] = [];
      const totalRows = rows.length;
      let teamsCreated = 0;
      let teamsFound = 0;
      let employeesCreated = 0;
      let employeesUpdated = 0;
      let assignmentsCreated = 0;
      let supervisorsLinked = 0;

      for (const teamEntry of teamMap.values()) {
        if (teamEntry.isNew) {
          teamsCreated++;
        } else {
          teamsFound++;
        }
      }

      if (input.dryRun) {
        const existingEmpCodes = new Set<string>();
        const empCodeRows = (await client.query('SELECT code FROM employees WHERE account_id = $1', [actor.accountId])).rows;
        for (const e of empCodeRows) existingEmpCodes.add(e.code);

        const seenInFile = new Set<string>();
        for (const r of rows) {
          if (!r.employeeCode) continue;
          if (seenInFile.has(r.employeeCode)) {
            warnings.push(`Código de agente duplicado en el archivo: "${r.employeeCode}". Se usará el último registro.`);
          }
          seenInFile.add(r.employeeCode);

          if (existingEmpCodes.has(r.employeeCode)) {
            employeesUpdated++;
          } else {
            employeesCreated++;
            existingEmpCodes.add(r.employeeCode);
          }
          assignmentsCreated++;
          if (r.supervisorCode) supervisorsLinked++;
        }

        return teamRosterImportResultSchema.parse({
          dryRun: true,
          totalRows,
          teamsCreated,
          teamsFound,
          employeesCreated,
          employeesUpdated,
          assignmentsCreated,
          supervisorsLinked,
          warnings,
          teamsSummary: Array.from(teamMap.values()).map(t => ({
            name: t.name,
            slug: t.slug,
            isNew: t.isNew,
            membersCount: t.membersCount,
          })),
        });
      }

      // Ensure default employee_type exists in this account
      let defaultTypeId: string;
      const typeRows = (await client.query('SELECT id, name, slug FROM employee_types WHERE account_id = $1 ORDER BY created_at ASC', [actor.accountId])).rows;
      if (typeRows.length > 0) {
        defaultTypeId = typeRows[0]!.id;
      } else {
        const insType = await client.query(
          `INSERT INTO employee_types(tenant_id, account_id, name, slug, description)
           VALUES ($1, $2, 'Agente', 'agente', 'Rol operativo estándar de call center')
           RETURNING id`,
          [actor.tenantId, actor.accountId]
        );
        defaultTypeId = insType.rows[0]!.id;
      }
      const typeBySlug = new Map<string, string>();
      for (const t of typeRows) {
        typeBySlug.set(t.slug, t.id);
        typeBySlug.set(t.name.toLowerCase().trim(), t.id);
      }

      // Create new teams
      for (const teamEntry of teamMap.values()) {
        if (teamEntry.isNew) {
          let slug = teamEntry.slug;
          let counter = 1;
          while (existingTeamsBySlug.has(slug)) {
            slug = `${teamEntry.slug}_${counter++}`;
          }
          const res = await client.query(
            `INSERT INTO teams(tenant_id, account_id, name, slug, description)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, slug`,
            [actor.tenantId, actor.accountId, teamEntry.name, slug, `Equipo importado desde Excel (${input.filename})`]
          );
          const newTeamId = res.rows[0]!.id as string;
          const newTeamSlug = res.rows[0]!.slug as string;
          teamEntry.id = newTeamId;
          teamEntry.slug = newTeamSlug;
          existingTeamsBySlug.set(slug, { id: newTeamId, name: teamEntry.name, slug });
          existingTeamsByName.set(teamEntry.name.toLowerCase().trim(), { id: newTeamId, name: teamEntry.name, slug });
        }
      }

      // Cache existing weeks
      const weeksByCode = new Map<string, string>();
      const weekRows = (await client.query('SELECT id, week_code FROM workforce_weeks WHERE account_id = $1', [actor.accountId])).rows;
      for (const w of weekRows) {
        weeksByCode.set(w.week_code, w.id);
      }

      const pendingSupervisors: { employeeId: string; supervisorCode: string; weekId?: string | undefined }[] = [];
      const handledEmployees = new Map<string, string>();

      for (const r of rows) {
        if (!r.employeeCode) continue;

        const teamEntry = teamMap.get(r.teamName.toLowerCase().trim());
        const teamId = teamEntry?.id;

        let targetWeekId: string | undefined = input.defaultWeekId;
        if (r.weekCode && weeksByCode.has(r.weekCode)) {
          targetWeekId = weeksByCode.get(r.weekCode);
        }

        let empTypeId = defaultTypeId;
        if (r.role) {
          const matchedType = typeBySlug.get(r.role.toLowerCase().trim()) || typeBySlug.get(slugify(r.role));
          if (matchedType) empTypeId = matchedType;
        }

        let empId: string;
        if (handledEmployees.has(r.employeeCode)) {
          empId = handledEmployees.get(r.employeeCode)!;
        } else {
          const existingEmp = (await client.query(
            'SELECT id, first_name, last_name, email, bms_id, wave FROM employees WHERE code = $1 AND account_id = $2',
            [r.employeeCode, actor.accountId]
          )).rows[0];

          if (!existingEmp) {
            const fn = r.firstName || 'Agente';
            const ln = r.lastName || r.employeeCode;
            const ins = await client.query(
              `INSERT INTO employees(tenant_id, account_id, code, first_name, last_name, email, status, bms_id, wave)
               VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
               RETURNING id`,
              [actor.tenantId, actor.accountId, r.employeeCode, fn, ln, r.email || null, r.bmsId || null, r.wave || null]
            );
            empId = ins.rows[0]!.id;
            employeesCreated++;
          } else {
            empId = existingEmp.id;
            await client.query(
              `UPDATE employees
               SET first_name = COALESCE($1, first_name),
                   last_name = COALESCE($2, last_name),
                   email = COALESCE($3, email),
                   bms_id = COALESCE($4, bms_id),
                   wave = COALESCE($5, wave)
               WHERE id = $6`,
              [r.firstName || null, r.lastName || null, r.email || null, r.bmsId || null, r.wave || null, empId]
            );
            employeesUpdated++;
          }
          handledEmployees.set(r.employeeCode, empId);
        }

        if (teamId) {
          await client.query(
            `UPDATE employment_assignments
             SET valid_to = now()
             WHERE employee_id = $1 AND valid_to IS NULL`,
            [empId]
          );

          await client.query(
            `INSERT INTO employment_assignments(tenant_id, account_id, employee_id, employee_type_id, team_id, week_id, metadata, valid_from)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [actor.tenantId, actor.accountId, empId, empTypeId, teamId, targetWeekId ?? null, JSON.stringify({ importedFrom: input.filename })]
          );
          assignmentsCreated++;
        }

        if (r.supervisorCode) {
          pendingSupervisors.push({ employeeId: empId, supervisorCode: r.supervisorCode, weekId: targetWeekId });
        }
      }

      // Link supervisors
      for (const ps of pendingSupervisors) {
        const supRow = (await client.query(
          'SELECT id FROM employees WHERE code = $1 AND account_id = $2',
          [ps.supervisorCode, actor.accountId]
        )).rows[0];

        if (supRow && supRow.id !== ps.employeeId) {
          await client.query(
            `UPDATE employee_relationships
             SET valid_to = now()
             WHERE employee_id = $1 AND relation_type = 'supervisor' AND valid_to IS NULL`,
            [ps.employeeId]
          );

          await client.query(
            `INSERT INTO employee_relationships(tenant_id, account_id, employee_id, manager_id, relation_type, week_id, valid_from)
             VALUES ($1, $2, $3, $4, 'supervisor', $5, now())`,
            [actor.tenantId, actor.accountId, ps.employeeId, supRow.id, ps.weekId ?? null]
          );
          supervisorsLinked++;
        } else {
          warnings.push(`Supervisor con código "${ps.supervisorCode}" no encontrado o idéntico al empleado.`);
        }
      }

      // Create frozen roster version and entries if a week is targeted
      const effectiveWeekId = input.defaultWeekId || (rows[0]?.weekCode ? weeksByCode.get(rows[0].weekCode) : undefined);
      if (effectiveWeekId) {
        const nextVerRow = (await client.query<{ next_num: number }>(
          'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num FROM workforce_roster_versions WHERE week_id = $1 AND account_id = $2',
          [effectiveWeekId, actor.accountId]
        )).rows[0];
        const nextVerNum = nextVerRow?.next_num ?? 1;

        const rVer = await client.query<{ id: string }>(
          `INSERT INTO workforce_roster_versions (tenant_id, account_id, week_id, version_number, status, row_count, created_by, published_at)
           VALUES ($1, $2, $3, $4, 'published', $5, $6, now())
           RETURNING id`,
          [actor.tenantId, actor.accountId, effectiveWeekId, nextVerNum, rows.length, actor.userId]
        );
        const rosterVersionId = rVer.rows[0]!.id;

        for (const r of rows) {
          if (!r.employeeCode) continue;
          const empId = handledEmployees.get(r.employeeCode);
          if (!empId) continue;
          const teamEntry = teamMap.get(r.teamName.toLowerCase().trim());

          await client.query(
            `INSERT INTO workforce_roster_entries (
              tenant_id, account_id, roster_version_id, employee_id, employee_code, bms_id, wave,
              team_id, team_name, employee_type_slug, source_sheet, source_row
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              actor.tenantId, actor.accountId, rosterVersionId, empId, r.employeeCode,
              r.bmsId || null, r.wave || null, teamEntry?.id || null, teamEntry?.name || r.teamName,
              r.role ? slugify(r.role) : 'agente', null, null
            ]
          );
        }
      }

      await audit(client, actor, 'workforce.teams_roster_imported', actor.accountId ?? actor.tenantId, correlation);

      return teamRosterImportResultSchema.parse({
        dryRun: false,
        totalRows,
        teamsCreated,
        teamsFound,
        employeesCreated,
        employeesUpdated,
        assignmentsCreated,
        supervisorsLinked,
        warnings,
        teamsSummary: Array.from(teamMap.values()).map(t => ({
          name: t.name,
          slug: t.slug,
          isNew: t.isNew,
          membersCount: t.membersCount,
        })),
      });
    });
  }

  // --- Employees ---

  async listEmployees(actor: DataActor, options: { teamId?: string | undefined; search?: string | undefined } = {}) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      let query = `
        SELECT 
          e.id, e.account_id AS "accountId", e.code, e.first_name AS "firstName", e.last_name AS "lastName",
          e.normalized_name AS "normalizedName", e.bms_id AS "bmsId", e.wave,
          COALESCE(e.custom_fields, '{}'::jsonb) AS "customFields",
          e.email, e.status, e.hire_date::text AS "hireDate", e.created_at::text AS "createdAt",
          cur_a.employee_type_id AS "currentEmployeeTypeId", et.name AS "currentEmployeeTypeName",
          cur_a.team_id AS "currentTeamId", t.name AS "currentTeamName",
          cur_r.manager_id AS "currentManagerId", 
          CASE WHEN m.id IS NOT NULL THEN CONCAT(m.first_name, ' ', m.last_name) ELSE NULL END AS "currentManagerName"
        FROM employees e
        LEFT JOIN LATERAL (
          SELECT employee_type_id, team_id
          FROM employment_assignments
          WHERE employee_id = e.id AND (valid_to IS NULL OR valid_to > now())
          ORDER BY valid_from DESC LIMIT 1
        ) cur_a ON true
        LEFT JOIN employee_types et ON et.id = cur_a.employee_type_id
        LEFT JOIN teams t ON t.id = cur_a.team_id
        LEFT JOIN LATERAL (
          SELECT manager_id
          FROM employee_relationships
          WHERE employee_id = e.id AND (valid_to IS NULL OR valid_to > now())
          ORDER BY valid_from DESC LIMIT 1
        ) cur_r ON true
        LEFT JOIN employees m ON m.id = cur_r.manager_id
      `;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options.teamId) {
        params.push(options.teamId);
        conditions.push(`cur_a.team_id = $${params.length}`);
      }

      if (options.search) {
        params.push(`%${options.search}%`);
        conditions.push(`(e.code ILIKE $${params.length} OR e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.email ILIKE $${params.length} OR e.bms_id ILIKE $${params.length} OR e.normalized_name ILIKE $${params.length})`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY e.last_name ASC, e.first_name ASC LIMIT 200`;

      const rows = (await client.query(query, params)).rows;
      return employeeListSchema.parse({ items: rows });
    });
  }

  private async getEmployeeInternal(client: PoolClient, id: string) {
    const row = (await client.query(
      `SELECT 
        e.id, e.account_id AS "accountId", e.code, e.first_name AS "firstName", e.last_name AS "lastName",
        e.normalized_name AS "normalizedName", e.bms_id AS "bmsId", e.wave,
        COALESCE(e.custom_fields, '{}'::jsonb) AS "customFields",
        e.email, e.status, e.hire_date::text AS "hireDate", e.created_at::text AS "createdAt",
        cur_a.employee_type_id AS "currentEmployeeTypeId", et.name AS "currentEmployeeTypeName",
        cur_a.team_id AS "currentTeamId", t.name AS "currentTeamName",
        cur_r.manager_id AS "currentManagerId", 
        CASE WHEN m.id IS NOT NULL THEN CONCAT(m.first_name, ' ', m.last_name) ELSE NULL END AS "currentManagerName"
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT employee_type_id, team_id
        FROM employment_assignments
        WHERE employee_id = e.id AND (valid_to IS NULL OR valid_to > now())
        ORDER BY valid_from DESC LIMIT 1
      ) cur_a ON true
      LEFT JOIN employee_types et ON et.id = cur_a.employee_type_id
      LEFT JOIN teams t ON t.id = cur_a.team_id
      LEFT JOIN LATERAL (
        SELECT manager_id
        FROM employee_relationships
        WHERE employee_id = e.id AND (valid_to IS NULL OR valid_to > now())
        ORDER BY valid_from DESC LIMIT 1
      ) cur_r ON true
      LEFT JOIN employees m ON m.id = cur_r.manager_id
      WHERE e.id = $1`,
      [z.uuid().parse(id)]
    )).rows[0];

    if (!row) throw new DomainError('EMPLOYEE_NOT_FOUND', 404, 'Empleado no encontrado.');
    return employeeSchema.parse(row);
  }

  async getEmployee(actor: DataActor, id: string) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      return this.getEmployeeInternal(client, id);
    });
  }

  async createEmployee(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para registrar agentes.');
    const input = employeeCreateSchema.parse(body);

    return execute(this.pool, actor, async client => {
      const existing = (await client.query(
        'SELECT id FROM employees WHERE code = $1 AND account_id = $2',
        [input.code, actor.accountId]
      )).rows[0];
      if (existing) {
        throw new DomainError('EMPLOYEE_CODE_EXISTS', 409, `El código de agente "${input.code}" ya está registrado en esta cuenta.`);
      }

      const empResult = await client.query(
        `INSERT INTO employees(tenant_id, account_id, code, first_name, last_name, email, status, hire_date, bms_id, wave, custom_fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          actor.tenantId,
          actor.accountId,
          input.code,
          input.firstName,
          input.lastName,
          input.email || null,
          input.status,
          input.hireDate || null,
          input.bmsId || null,
          input.wave || null,
          JSON.stringify(input.customFields ?? {}),
        ]
      );
      const employeeId = empResult.rows[0]!.id;

      if (input.employeeTypeId) {
        await client.query(
          `INSERT INTO employment_assignments(tenant_id, account_id, employee_id, employee_type_id, team_id, valid_from)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [actor.tenantId, actor.accountId, employeeId, input.employeeTypeId, input.teamId ?? null]
        );
      }

      if (input.managerId) {
        await client.query(
          `INSERT INTO employee_relationships(tenant_id, account_id, employee_id, manager_id, relation_type, valid_from)
           VALUES ($1, $2, $3, $4, 'supervisor', now())`,
          [actor.tenantId, actor.accountId, employeeId, input.managerId]
        );
      }

      await audit(client, actor, 'workforce.employee_created', employeeId, correlation);
      return this.getEmployeeInternal(client, employeeId);
    });
  }

  // --- Assignments & History ---

  async listAssignments(actor: DataActor, employeeId: string) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT 
          a.id, a.employee_id AS "employeeId", a.employee_type_id AS "employeeTypeId", 
          et.name AS "employeeTypeName", a.team_id AS "teamId", t.name AS "teamName", 
          a.account_id AS "accountId", a.week_id AS "weekId", ww.week_code AS "weekCode",
          COALESCE(a.metadata, '{}'::jsonb) AS "metadata",
          a.valid_from::text AS "validFrom", 
          a.valid_to::text AS "validTo", a.created_at::text AS "createdAt"
         FROM employment_assignments a
         JOIN employee_types et ON et.id = a.employee_type_id
         LEFT JOIN teams t ON t.id = a.team_id
         LEFT JOIN workforce_weeks ww ON ww.id = a.week_id
         WHERE a.employee_id = $1
         ORDER BY a.valid_from DESC`,
        [z.uuid().parse(employeeId)]
      )).rows;
      return employmentAssignmentListSchema.parse({ items: rows });
    });
  }

  async createAssignment(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = employmentAssignmentCreateSchema.parse(body);
    const accountId = actor.accountId || input.accountId;
    if (!accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para registrar asignaciones.');

    return execute(this.pool, actor, async client => {
      await client.query(
        `UPDATE employment_assignments 
         SET valid_to = now() 
         WHERE employee_id = $1 AND valid_to IS NULL`,
        [input.employeeId]
      );

      const result = await client.query(
        `INSERT INTO employment_assignments(tenant_id, account_id, employee_id, employee_type_id, team_id, week_id, metadata, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9::timestamptz)
         RETURNING id`,
        [
          actor.tenantId,
          accountId,
          input.employeeId,
          input.employeeTypeId,
          input.teamId ?? null,
          input.weekId ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.validFrom ?? null,
          input.validTo ?? null,
        ]
      );
      const assignmentId = result.rows[0]!.id;
      await audit(client, actor, 'workforce.assignment_created', assignmentId, correlation);

      const row = (await client.query(
        `SELECT 
          a.id, a.employee_id AS "employeeId", a.employee_type_id AS "employeeTypeId", 
          et.name AS "employeeTypeName", a.team_id AS "teamId", t.name AS "teamName", 
          a.account_id AS "accountId", a.week_id AS "weekId", ww.week_code AS "weekCode",
          COALESCE(a.metadata, '{}'::jsonb) AS "metadata",
          a.valid_from::text AS "validFrom", 
          a.valid_to::text AS "validTo", a.created_at::text AS "createdAt"
         FROM employment_assignments a
         JOIN employee_types et ON et.id = a.employee_type_id
         LEFT JOIN teams t ON t.id = a.team_id
         LEFT JOIN workforce_weeks ww ON ww.id = a.week_id
         WHERE a.id = $1`,
        [assignmentId]
      )).rows[0]!;

      return employmentAssignmentSchema.parse(row);
    });
  }

  // --- Relationships & Hierarchy ---

  async listRelationships(actor: DataActor, employeeId: string) {
    permit(actor, 'workforce.read');
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT 
          r.id, r.employee_id AS "employeeId", r.manager_id AS "managerId",
          CONCAT(m.first_name, ' ', m.last_name) AS "managerName",
          r.relation_type AS "relationType", r.week_id AS "weekId", ww.week_code AS "weekCode",
          r.valid_from::text AS "validFrom",
          r.valid_to::text AS "validTo", r.created_at::text AS "createdAt"
         FROM employee_relationships r
         JOIN employees m ON m.id = r.manager_id
         LEFT JOIN workforce_weeks ww ON ww.id = r.week_id
         WHERE r.employee_id = $1
         ORDER BY r.valid_from DESC`,
        [z.uuid().parse(employeeId)]
      )).rows;
      return employeeRelationshipListSchema.parse({ items: rows });
    });
  }

  async createRelationship(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para crear jerarquías laborales.');
    const input = employeeRelationshipCreateSchema.parse(body);

    return execute(this.pool, actor, async client => {
      await client.query(
        `UPDATE employee_relationships
         SET valid_to = now()
         WHERE employee_id = $1 AND relation_type = $2 AND valid_to IS NULL`,
        [input.employeeId, input.relationType]
      );

      const result = await client.query(
        `INSERT INTO employee_relationships(tenant_id, account_id, employee_id, manager_id, relation_type, week_id, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8::timestamptz)
         RETURNING id`,
        [
          actor.tenantId,
          actor.accountId,
          input.employeeId,
          input.managerId,
          input.relationType,
          input.weekId ?? null,
          input.validFrom ?? null,
          input.validTo ?? null,
        ]
      );
      const relId = result.rows[0]!.id;
      await audit(client, actor, 'workforce.relationship_created', relId, correlation);

      const row = (await client.query(
        `SELECT 
          r.id, r.employee_id AS "employeeId", r.manager_id AS "managerId",
          CONCAT(m.first_name, ' ', m.last_name) AS "managerName",
          r.relation_type AS "relationType", r.week_id AS "weekId", ww.week_code AS "weekCode",
          r.valid_from::text AS "validFrom",
          r.valid_to::text AS "validTo", r.created_at::text AS "createdAt"
         FROM employee_relationships r
         JOIN employees m ON m.id = r.manager_id
         LEFT JOIN workforce_weeks ww ON ww.id = r.week_id
         WHERE r.id = $1`,
        [relId]
      )).rows[0]!;

      return employeeRelationshipSchema.parse(row);
    });
  }

  // --- Roster Versions & Frozen Entries ---

  async listRosterVersions(actor: DataActor, weekId: string) {
    permit(actor, 'workforce.read');
    const wId = z.uuid().parse(weekId);
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT id, week_id AS "weekId", version_number AS "versionNumber", status,
                storage_path AS "storagePath", sha256, mapping, row_count AS "rowCount",
                issue_count AS "issueCount", created_by AS "createdBy",
                created_at::text AS "createdAt", published_at::text AS "publishedAt"
         FROM workforce_roster_versions
         WHERE week_id = $1
         ORDER BY version_number DESC`,
        [wId]
      )).rows;
      return rows;
    });
  }

  async getRosterEntries(actor: DataActor, rosterVersionId: string) {
    permit(actor, 'workforce.read');
    const rvId = z.uuid().parse(rosterVersionId);
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(
        `SELECT id, roster_version_id AS "rosterVersionId", employee_id AS "employeeId",
                employee_code AS "employeeCode", bms_id AS "bmsId", wave,
                team_id AS "teamId", team_name AS "teamName",
                employee_type_slug AS "employeeTypeSlug",
                supervisor_id AS "supervisorId", supervisor_name AS "supervisorName",
                floor_manager_id AS "floorManagerId", floor_manager_name AS "floorManagerName",
                metadata, source_sheet AS "sourceSheet", source_row AS "sourceRow"
         FROM workforce_roster_entries
         WHERE roster_version_id = $1
         ORDER BY employee_code ASC LIMIT 1000`,
        [rvId]
      )).rows;
      return rows;
    });
  }

  async publishRosterVersion(actor: DataActor, rosterVersionId: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const rvId = z.uuid().parse(rosterVersionId);
    return execute(this.pool, actor, async client => {
      const ver = (await client.query<{ id: string; week_id: string; status: string }>(
        'SELECT id, week_id, status FROM workforce_roster_versions WHERE id = $1 FOR UPDATE',
        [rvId]
      )).rows[0];
      if (!ver) throw new DomainError('ROSTER_NOT_FOUND', 404, 'Versión de roster no encontrada.');

      await client.query(
        "UPDATE workforce_roster_versions SET status = 'published', published_at = now() WHERE id = $1",
        [rvId]
      );
      await audit(client, actor, 'workforce.roster_published', rvId, correlation);
      return { ok: true, id: rvId, status: 'published' };
    });
  }

  async cloneWeekRoster(actor: DataActor, sourceWeekId: string, targetWeekId: string, correlation: string) {
    permit(actor, 'workforce.manage');
    if (!actor.accountId) throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para clonar rosters.');
    const srcId = z.uuid().parse(sourceWeekId);
    const tgtId = z.uuid().parse(targetWeekId);

    return execute(this.pool, actor, async client => {
      const srcVer = (await client.query<{ id: string }>(
        `SELECT id FROM workforce_roster_versions
         WHERE week_id = $1 AND account_id = $2
         ORDER BY (status = 'published') DESC, version_number DESC
         LIMIT 1`,
        [srcId, actor.accountId]
      )).rows[0];

      let copiedCount = 0;
      if (srcVer) {
        const nextVerRow = (await client.query<{ next_num: number }>(
          'SELECT COALESCE(MAX(version_number), 0) + 1 AS next_num FROM workforce_roster_versions WHERE week_id = $1 AND account_id = $2',
          [tgtId, actor.accountId]
        )).rows[0];
        const nextVerNum = nextVerRow?.next_num ?? 1;

        const newVer = await client.query<{ id: string }>(
          `INSERT INTO workforce_roster_versions (tenant_id, account_id, week_id, version_number, status, created_by, published_at)
           VALUES ($1, $2, $3, $4, 'published', $5, now())
           RETURNING id`,
          [actor.tenantId, actor.accountId, tgtId, nextVerNum, actor.userId]
        );
        const newVerId = newVer.rows[0]!.id;

        const entries = (await client.query(
          'SELECT * FROM workforce_roster_entries WHERE roster_version_id = $1',
          [srcVer.id]
        )).rows;

        for (const e of entries) {
          await client.query(
            `INSERT INTO workforce_roster_entries (
              tenant_id, account_id, roster_version_id, employee_id, employee_code, bms_id, wave,
              team_id, team_name, employee_type_slug, supervisor_id, supervisor_name,
              floor_manager_id, floor_manager_name, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              actor.tenantId, actor.accountId, newVerId, e.employee_id, e.employee_code, e.bms_id, e.wave,
              e.team_id, e.team_name, e.employee_type_slug, e.supervisor_id, e.supervisor_name,
              e.floor_manager_id, e.floor_manager_name, JSON.stringify(e.metadata ?? {})
            ]
          );
        }
        copiedCount = entries.length;
        await client.query('UPDATE workforce_roster_versions SET row_count = $1 WHERE id = $2', [copiedCount, newVerId]);
      } else {
        const assignments = (await client.query<{ employee_id: string; employee_type_id: string; team_id: string | null; metadata: any }>(
          `SELECT employee_id, employee_type_id, team_id, metadata
           FROM employment_assignments
           WHERE week_id = $1 AND account_id = $2 AND (valid_to IS NULL OR valid_to > now())`,
          [srcId, actor.accountId]
        )).rows;

        for (const a of assignments) {
          await client.query(
            `INSERT INTO employment_assignments (tenant_id, account_id, employee_id, employee_type_id, team_id, week_id, metadata, valid_from)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [actor.tenantId, actor.accountId, a.employee_id, a.employee_type_id, a.team_id, tgtId, JSON.stringify(a.metadata ?? {})]
          );
          copiedCount++;
        }
      }

      await audit(client, actor, 'workforce.week_roster_cloned', tgtId, correlation);
      return { ok: true, sourceWeekId: srcId, targetWeekId: tgtId, copiedCount };
    });
  }
}
