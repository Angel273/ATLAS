import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool } from '@atlas/database';
import { WorkforceService } from './workforce/workforce.service.js';
import {
  roleCapabilities,
  type DataActor,
} from '@atlas/contracts';

describe('Phase 4: Workforce / Agent Definer, Temporal Assignments and RLS', () => {
  const admin = createPool(process.env.ADMIN_DATABASE_URL);
  const workforce = new WorkforceService();

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userAdmin = randomUUID();
  const userSupervisor = randomUUID();
  const userAnalyst = randomUUID();

  const adminActor: DataActor = {
    tenantId: tenantA,
    userId: userAdmin,
    capabilities: [...roleCapabilities.admin],
  };

  const supervisorActor: DataActor = {
    tenantId: tenantA,
    userId: userSupervisor,
    capabilities: [...roleCapabilities.supervisor],
  };

  const analystActor: DataActor = {
    tenantId: tenantA,
    userId: userAnalyst,
    capabilities: ['dashboard.read', 'semantic.read', 'ai.use'], // lacks workforce.read & workforce.manage
  };

  const otherTenantActor: DataActor = {
    ...adminActor,
    tenantId: tenantB,
  };

  let agentTypeId: string;
  let supervisorTypeId: string;
  let teamAlphaId: string;
  let teamBetaId: string;
  let supervisorEmployeeId: string;
  let agentEmployeeId: string;

  beforeAll(async () => {
    await admin.query('INSERT INTO organizations(id, name) VALUES($1, $2), ($3, $4)', [
      tenantA,
      'Workforce Org A',
      tenantB,
      'Workforce Org B',
    ]);
    await admin.query(
      "INSERT INTO identity.users(id, email, password_hash, mfa_enabled, mfa_secret) VALUES($1, $2, $3, true, 'synthetic-secret'), ($4, $5, $3, false, null), ($6, $7, $3, false, null)",
      [
        userAdmin,
        `wf-admin-${tenantA}@example.invalid`,
        'synthetic-hash',
        userSupervisor,
        `wf-sup-${tenantA}@example.invalid`,
        userAnalyst,
        `wf-ana-${tenantA}@example.invalid`,
      ]
    );
    await admin.query(
      'INSERT INTO identity.memberships(tenant_id, user_id, role) VALUES($1, $2, $3), ($4, $5, $6), ($7, $8, $9)',
      [
        tenantA,
        userAdmin,
        'admin',
        tenantA,
        userSupervisor,
        'supervisor',
        tenantA,
        userAnalyst,
        'ceo',
      ]
    );
  });

  afterAll(async () => {
    await workforce.onModuleDestroy();
    await admin.query('DELETE FROM employment_assignments WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM employee_relationships WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM employees WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM teams WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM employee_types WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM identity.memberships WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM public.audit_events WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await admin.query('DELETE FROM organizations WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await admin.end();
  });

  it('creates employee types and teams with unique slugs per tenant', async () => {
    const type1 = await workforce.createEmployeeType(
      adminActor,
      { name: 'Agente de Contacto', slug: 'agente_contacto', description: 'Agente de primera línea' },
      randomUUID(),
      randomUUID()
    );
    expect(type1.id).toBeDefined();
    expect(type1.name).toBe('Agente de Contacto');
    agentTypeId = type1.id;

    const type2 = await workforce.createEmployeeType(
      adminActor,
      { name: 'Supervisor de Operaciones', slug: 'supervisor_ops', description: 'Líder de equipo' },
      randomUUID(),
      randomUUID()
    );
    supervisorTypeId = type2.id;

    const team1 = await workforce.createTeam(
      adminActor,
      { name: 'Equipo Alfa - Soporte', slug: 'equipo_alfa', description: 'Mesa de ayuda nivel 1' },
      randomUUID(),
      randomUUID()
    );
    expect(team1.id).toBeDefined();
    teamAlphaId = team1.id;

    const team2 = await workforce.createTeam(
      adminActor,
      { name: 'Equipo Beta - Ventas', slug: 'equipo_beta', description: 'Ventas salientes' },
      randomUUID(),
      randomUUID()
    );
    teamBetaId = team2.id;

    const types = await workforce.listEmployeeTypes(supervisorActor);
    expect(types.items.length).toBe(2);

    const teams = await workforce.listTeams(supervisorActor);
    expect(teams.items.length).toBe(2);
  });

  it('creates employees and registers initial assignments and relationships', async () => {
    // 1. Create supervisor
    const supervisor = await workforce.createEmployee(
      adminActor,
      {
        code: 'SUP-001',
        firstName: 'Elena',
        lastName: 'Rostova',
        email: 'elena.rostova@example.invalid',
        employeeTypeId: supervisorTypeId,
        teamId: teamAlphaId,
      },
      randomUUID(),
      randomUUID()
    );
    expect(supervisor.code).toBe('SUP-001');
    expect(supervisor.currentEmployeeTypeName).toBe('Supervisor de Operaciones');
    expect(supervisor.currentTeamName).toBe('Equipo Alfa - Soporte');
    supervisorEmployeeId = supervisor.id;

    // 2. Create agent assigned to supervisor
    const agent = await workforce.createEmployee(
      adminActor,
      {
        code: 'AGT-101',
        firstName: 'Carlos',
        lastName: 'Mendoza',
        email: 'carlos.mendoza@example.invalid',
        status: 'active',
        hireDate: '2026-01-15',
        employeeTypeId: agentTypeId,
        teamId: teamAlphaId,
        managerId: supervisorEmployeeId,
      },
      randomUUID(),
      randomUUID()
    );
    expect(agent.code).toBe('AGT-101');
    expect(agent.currentEmployeeTypeName).toBe('Agente de Contacto');
    expect(agent.currentTeamName).toBe('Equipo Alfa - Soporte');
    expect(agent.currentManagerName).toBe('Elena Rostova');
    agentEmployeeId = agent.id;
  });

  it('prevents duplicate employee codes within the same tenant', async () => {
    await expect(
      workforce.createEmployee(
        adminActor,
        {
          code: 'AGT-101', // Already exists in tenant A
          firstName: 'Otro',
          lastName: 'Agente',
        },
        randomUUID(),
        randomUUID()
      )
    ).rejects.toThrow('El código de agente "AGT-101" ya está registrado');
  });

  it('preserves assignment history with valid_from and valid_to on team transfer', async () => {
    // Transfer agent from Team Alfa to Team Beta
    const newAssignment = await workforce.createAssignment(
      adminActor,
      {
        employeeId: agentEmployeeId,
        employeeTypeId: agentTypeId,
        teamId: teamBetaId,
      },
      randomUUID(),
      randomUUID()
    );

    expect(newAssignment.teamId).toBe(teamBetaId);
    expect(newAssignment.validTo).toBeNull(); // Current assignment

    // Check full history of assignments
    const history = await workforce.listAssignments(supervisorActor, agentEmployeeId);
    expect(history.items.length).toBe(2);

    const previous = history.items.find(a => a.teamId === teamAlphaId);
    const current = history.items.find(a => a.teamId === teamBetaId);

    expect(previous).toBeDefined();
    expect(previous?.validTo).not.toBeNull(); // Closed previous period
    expect(current).toBeDefined();
    expect(current?.validTo).toBeNull(); // Ongoing current period

    // Listing employee reflects current team
    const updated = await workforce.getEmployee(supervisorActor, agentEmployeeId);
    expect(updated.currentTeamName).toBe('Equipo Beta - Ventas');
  });

  it('enforces PostgreSQL Row-Level Security (RLS) across tenants', async () => {
    // Tenant B attempts to read employees of Tenant A
    const tenantBEmployees = await workforce.listEmployees(otherTenantActor);
    expect(tenantBEmployees.items.length).toBe(0);

    // Tenant B attempts to get specific employee of Tenant A
    await expect(
      workforce.getEmployee(otherTenantActor, agentEmployeeId)
    ).rejects.toThrow('Empleado no encontrado.');

    // Tenant B attempts to read teams of Tenant A
    const tenantBTeams = await workforce.listTeams(otherTenantActor);
    expect(tenantBTeams.items.length).toBe(0);

    // Tenant B can create an employee with the SAME natural code "AGT-101" without collision!
    const tenantBEmp = await workforce.createEmployee(
      otherTenantActor,
      {
        code: 'AGT-101', // Same natural code as Tenant A
        firstName: 'Beatriz',
        lastName: 'Navarro',
      },
      randomUUID(),
      randomUUID()
    );
    expect(tenantBEmp.code).toBe('AGT-101');
    expect(tenantBEmp.id).not.toBe(agentEmployeeId);
  });

  it('enforces capability checks: users without workforce permissions are rejected', async () => {
    await expect(workforce.listEmployees(analystActor)).rejects.toThrow();
    await expect(
      workforce.createEmployee(
        supervisorActor, // supervisor has workforce.read but NOT workforce.manage
        {
          code: 'AGT-999',
          firstName: 'No',
          lastName: 'Permitido',
        },
        randomUUID(),
        randomUUID()
      )
    ).rejects.toThrow();
  });
});
