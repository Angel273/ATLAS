import { z } from 'zod';
import { createPool, withTenant, type PoolClient, type Pool } from '@atlas/database';
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
  type DataActor,
} from '@atlas/contracts';
import { permit, audit } from '@atlas/ingestion';

export class WorkforceService {
  readonly pool: Pool = createPool(process.env.DATABASE_URL);

  async onModuleDestroy() {
    await this.pool.end();
  }

  // --- Employee Types ---

  async listEmployeeTypes(actor: DataActor) {
    permit(actor, 'workforce.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      const rows = (await client.query(
        `SELECT id, name, slug, description, created_at::text AS "createdAt"
         FROM employee_types
         ORDER BY name ASC`
      )).rows;
      return employeeTypeListSchema.parse({ items: rows });
    });
  }

  async createEmployeeType(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = employeeTypeCreateSchema.parse(body);
    return withTenant(this.pool, actor.tenantId, async client => {
      const existing = (await client.query(
        `SELECT id, name, slug, description, created_at::text AS "createdAt"
         FROM employee_types WHERE slug = $1`,
        [input.slug]
      )).rows[0];
      if (existing) return employeeTypeSchema.parse(existing);

      const result = await client.query(
        `INSERT INTO employee_types(tenant_id, name, slug, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, description, created_at::text AS "createdAt"`,
        [actor.tenantId, input.name, input.slug, input.description]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.employee_type_created', row.id, correlation);
      return employeeTypeSchema.parse(row);
    });
  }

  // --- Teams ---

  async listTeams(actor: DataActor) {
    permit(actor, 'workforce.read');
    return withTenant(this.pool, actor.tenantId, async client => {
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
    return withTenant(this.pool, actor.tenantId, async client => {
      const existing = (await client.query(
        `SELECT id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"
         FROM teams WHERE slug = $1`,
        [input.slug]
      )).rows[0];
      if (existing) return teamSchema.parse(existing);

      const result = await client.query(
        `INSERT INTO teams(tenant_id, account_id, name, slug, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, account_id AS "accountId", name, slug, description, created_at::text AS "createdAt"`,
        [actor.tenantId, input.accountId ?? null, input.name, input.slug, input.description]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.team_created', row.id, correlation);
      return teamSchema.parse(row);
    });
  }

  // --- Employees ---

  async listEmployees(actor: DataActor, options: { teamId?: string | undefined; search?: string | undefined } = {}) {
    permit(actor, 'workforce.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      let query = `
        SELECT 
          e.id, e.code, e.first_name AS "firstName", e.last_name AS "lastName",
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
        conditions.push(`(e.code ILIKE $${params.length} OR e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.email ILIKE $${params.length})`);
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
        e.id, e.code, e.first_name AS "firstName", e.last_name AS "lastName",
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
    return withTenant(this.pool, actor.tenantId, async client => {
      return this.getEmployeeInternal(client, id);
    });
  }

  async createEmployee(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = employeeCreateSchema.parse(body);

    return withTenant(this.pool, actor.tenantId, async client => {
      // Check code uniqueness within tenant
      const existing = (await client.query(
        'SELECT id FROM employees WHERE code = $1',
        [input.code]
      )).rows[0];
      if (existing) {
        throw new DomainError('EMPLOYEE_CODE_EXISTS', 409, `El código de agente "${input.code}" ya está registrado en la organización.`);
      }

      const empResult = await client.query(
        `INSERT INTO employees(tenant_id, code, first_name, last_name, email, status, hire_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          actor.tenantId,
          input.code,
          input.firstName,
          input.lastName,
          input.email || null,
          input.status,
          input.hireDate || null,
        ]
      );
      const employeeId = empResult.rows[0]!.id;

      // Create initial employment assignment if type specified
      if (input.employeeTypeId) {
        await client.query(
          `INSERT INTO employment_assignments(tenant_id, employee_id, employee_type_id, team_id, valid_from)
           VALUES ($1, $2, $3, $4, now())`,
          [actor.tenantId, employeeId, input.employeeTypeId, input.teamId ?? null]
        );
      }

      // Create initial manager relationship if manager specified
      if (input.managerId) {
        await client.query(
          `INSERT INTO employee_relationships(tenant_id, employee_id, manager_id, relation_type, valid_from)
           VALUES ($1, $2, $3, 'supervisor', now())`,
          [actor.tenantId, employeeId, input.managerId]
        );
      }

      await audit(client, actor, 'workforce.employee_created', employeeId, correlation);
      return this.getEmployeeInternal(client, employeeId);
    });
  }

  // --- Assignments & History ---

  async listAssignments(actor: DataActor, employeeId: string) {
    permit(actor, 'workforce.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      const rows = (await client.query(
        `SELECT 
          a.id, a.employee_id AS "employeeId", a.employee_type_id AS "employeeTypeId", 
          et.name AS "employeeTypeName", a.team_id AS "teamId", t.name AS "teamName", 
          a.account_id AS "accountId", a.valid_from::text AS "validFrom", 
          a.valid_to::text AS "validTo", a.created_at::text AS "createdAt"
         FROM employment_assignments a
         JOIN employee_types et ON et.id = a.employee_type_id
         LEFT JOIN teams t ON t.id = a.team_id
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

    return withTenant(this.pool, actor.tenantId, async client => {
      // Close open active assignments for this employee
      await client.query(
        `UPDATE employment_assignments 
         SET valid_to = now() 
         WHERE employee_id = $1 AND valid_to IS NULL`,
        [input.employeeId]
      );

      const result = await client.query(
        `INSERT INTO employment_assignments(tenant_id, employee_id, employee_type_id, team_id, account_id, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7::timestamptz)
         RETURNING id, employee_id AS "employeeId", employee_type_id AS "employeeTypeId", team_id AS "teamId", account_id AS "accountId", valid_from::text AS "validFrom", valid_to::text AS "validTo", created_at::text AS "createdAt"`,
        [
          actor.tenantId,
          input.employeeId,
          input.employeeTypeId,
          input.teamId ?? null,
          input.accountId ?? null,
          input.validFrom ?? null,
          input.validTo ?? null,
        ]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.assignment_created', row.id, correlation);
      return employmentAssignmentSchema.parse(row);
    });
  }

  // --- Relationships & Hierarchy ---

  async listRelationships(actor: DataActor, employeeId: string) {
    permit(actor, 'workforce.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      const rows = (await client.query(
        `SELECT 
          r.id, r.employee_id AS "employeeId", r.manager_id AS "managerId",
          CONCAT(m.first_name, ' ', m.last_name) AS "managerName",
          r.relation_type AS "relationType", r.valid_from::text AS "validFrom",
          r.valid_to::text AS "validTo", r.created_at::text AS "createdAt"
         FROM employee_relationships r
         JOIN employees m ON m.id = r.manager_id
         WHERE r.employee_id = $1
         ORDER BY r.valid_from DESC`,
        [z.uuid().parse(employeeId)]
      )).rows;
      return employeeRelationshipListSchema.parse({ items: rows });
    });
  }

  async createRelationship(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'workforce.manage');
    const input = employeeRelationshipCreateSchema.parse(body);

    return withTenant(this.pool, actor.tenantId, async client => {
      // Close open active relationship of same type
      await client.query(
        `UPDATE employee_relationships
         SET valid_to = now()
         WHERE employee_id = $1 AND relation_type = $2 AND valid_to IS NULL`,
        [input.employeeId, input.relationType]
      );

      const result = await client.query(
        `INSERT INTO employee_relationships(tenant_id, employee_id, manager_id, relation_type, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6::timestamptz)
         RETURNING id, employee_id AS "employeeId", manager_id AS "managerId", relation_type AS "relationType", valid_from::text AS "validFrom", valid_to::text AS "validTo", created_at::text AS "createdAt"`,
        [
          actor.tenantId,
          input.employeeId,
          input.managerId,
          input.relationType,
          input.validFrom ?? null,
          input.validTo ?? null,
        ]
      );
      const row = result.rows[0]!;
      await audit(client, actor, 'workforce.relationship_created', row.id, correlation);
      return employeeRelationshipSchema.parse(row);
    });
  }
}
