/**
 * @file apps/api/src/workforce.integration.test.ts
 * @description Pruebas de integración para el módulo de Workforce / Agent Definer, semanas operativas y RLS.
 * Valida la creación de semanas operativas ISO, empleados, asignaciones con vigencia temporal (valid_from/valid_to),
 * jerarquías de supervisión y aislamiento de acceso entre organizaciones.
 */

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
    await admin.query('DELETE FROM workforce_weeks WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
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

  it('manages workforce weeks: creates, updates, queries current and bulk generates', async () => {
    const week = await workforce.createWeek(
      adminActor,
      {
        weekCode: '2026-W36',
        yearNumber: 2026,
        weekNumber: 36,
        startDate: '2026-08-31',
        status: 'current',
        customAttributes: { headcountTarget: 120, isPeak: false },
      },
      randomUUID(),
      randomUUID()
    );

    expect(week.id).toBeDefined();
    expect(week.weekCode).toBe('2026-W36');
    expect(week.startDate).toBe('2026-08-31');
    expect(week.endDate).toBe('2026-09-06'); // Exactly Monday + 6 days
    expect(week.status).toBe('current');
    expect(week.customAttributes).toEqual({ headcountTarget: 120, isPeak: false });

    // Current week query
    const current = await workforce.getCurrentWeek(supervisorActor);
    expect(current).not.toBeNull();
    expect(current?.weekCode).toBe('2026-W36');

    // Update status and custom attributes
    const updated = await workforce.updateWeek(
      adminActor,
      week.id,
      {
        status: 'closed',
        customAttributes: { actualHeadcount: 118, isPeak: true },
      },
      randomUUID()
    );
    expect(updated.status).toBe('closed');
    expect(updated.customAttributes.actualHeadcount).toBe(118);
    expect(updated.customAttributes.headcountTarget).toBe(120); // Merged attributes

    // Bulk generate year weeks
    const all2026 = await workforce.generateYearWeeks(adminActor, 2026, randomUUID());
    expect(all2026.items.length).toBeGreaterThanOrEqual(52);
    expect(all2026.items.some(w => w.weekCode === '2026-W01')).toBe(true);
  });

  it('supports bms_id, wave, custom_fields and computed normalized_name on employees', async () => {
    const employee = await workforce.createEmployee(
      adminActor,
      {
        code: 'AGT-202',
        firstName: '  Maria   Jose ',
        lastName: '  Lopez   Morales  ',
        bmsId: 'BMS-9988',
        wave: 'Wave 12',
        customFields: { site: 'Guatemala Site 1', modality: 'remoto' },
        employeeTypeId: agentTypeId,
        teamId: teamAlphaId,
      },
      randomUUID(),
      randomUUID()
    );

    expect(employee.code).toBe('AGT-202');
    expect(employee.bmsId).toBe('BMS-9988');
    expect(employee.wave).toBe('Wave 12');
    expect(employee.normalizedName).toBe('MARIA JOSE LOPEZ MORALES');
    expect(employee.customFields).toEqual({ site: 'Guatemala Site 1', modality: 'remoto' });

    // Search by bms_id
    const searchByBms = await workforce.listEmployees(supervisorActor, { search: 'BMS-9988' });
    expect(searchByBms.items.length).toBe(1);
    expect(searchByBms.items[0]?.code).toBe('AGT-202');

    // Search by normalized name
    const searchByName = await workforce.listEmployees(supervisorActor, { search: 'maria jose' });
    expect(searchByName.items.length).toBe(1);
    expect(searchByName.items[0]?.code).toBe('AGT-202');
  });

  it('links assignments and relationships to operational weeks and FM hierarchy', async () => {
    const week = await workforce.createWeek(
      adminActor,
      {
        weekCode: '2026-W37',
        yearNumber: 2026,
        weekNumber: 37,
        startDate: '2026-09-07',
        status: 'open',
      },
      randomUUID(),
      randomUUID()
    );

    // Create Floor Manager relationship
    const relationship = await workforce.createRelationship(
      adminActor,
      {
        employeeId: agentEmployeeId,
        managerId: supervisorEmployeeId,
        relationType: 'floor_manager',
        weekId: week.id,
      },
      randomUUID(),
      randomUUID()
    );
    expect(relationship.relationType).toBe('floor_manager');
    expect(relationship.weekId).toBe(week.id);
    expect(relationship.weekCode).toBe('2026-W37');

    // Create assignment linked to week and metadata
    const assignment = await workforce.createAssignment(
      adminActor,
      {
        employeeId: agentEmployeeId,
        employeeTypeId: agentTypeId,
        teamId: teamAlphaId,
        weekId: week.id,
        metadata: { weeklyShift: 'Morning A', contractedHours: 40 },
      },
      randomUUID(),
      randomUUID()
    );
    expect(assignment.weekId).toBe(week.id);
    expect(assignment.weekCode).toBe('2026-W37');
    expect(assignment.metadata).toEqual({ weeklyShift: 'Morning A', contractedHours: 40 });
  });

  it('generates an official Excel template for team and roster import', async () => {
    const templateBuffer = await workforce.getTeamTemplate(supervisorActor);
    expect(templateBuffer).toBeInstanceOf(Buffer);
    expect(templateBuffer.length).toBeGreaterThan(1000);
    // XLSX magic bytes: PK\x03\x04 (zip archive)
    expect(templateBuffer[0]).toBe(0x50);
    expect(templateBuffer[1]).toBe(0x4B);
  });

  it('imports teams and employee roster from Excel/CSV with dryRun preview and transactional execution', async () => {
    const week = await workforce.createWeek(
      adminActor,
      {
        weekCode: '2026-W38',
        yearNumber: 2026,
        weekNumber: 38,
        startDate: '2026-09-14',
        status: 'open',
      },
      randomUUID(),
      randomUUID()
    );

    const csvContent = [
      'Equipo,Codigo_Empleado,Nombres,Apellidos,Email,BMS_ID,Wave,Rol,Supervisor,Semana_Operativa',
      'Cobranzas Early,SUP-COB-01,Marcos,Valle,m.valle@example.invalid,BMS-880,Wave 08,Supervisor,,2026-W38',
      'Cobranzas Early,AG-COB-10,Elena,Rios,e.rios@example.invalid,BMS-881,Wave 14,Asesor,SUP-COB-01,2026-W38',
      'Cobranzas Early,AG-COB-11,David,Cruz,d.cruz@example.invalid,BMS-882,Wave 14,Asesor,SUP-COB-01,2026-W38',
      'Retenciones VIP,AG-RET-20,Sofia,Lara,s.lara@example.invalid,BMS-771,Wave 12,Asesor,,2026-W38',
      'Retenciones VIP,AG-RET-21,Mateo,Rojas,m.rojas@example.invalid,BMS-772,Wave 12,Asesor,,2026-W38',
      'Equipo Vacio Sin Agentes,,,,,,,,,',
    ].join('\n');

    const base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

    // 1. Dry run preview (should NOT mutate database)
    const preview = await workforce.importTeamsFromExcel(
      adminActor,
      {
        filename: 'roster_import_test.csv',
        base64Content,
        defaultWeekId: week.id,
        dryRun: true,
      },
      randomUUID()
    );

    expect(preview.dryRun).toBe(true);
    expect(preview.teamsCreated).toBe(3); // Cobranzas Early, Retenciones VIP, Equipo Vacio Sin Agentes
    expect(preview.teamsFound).toBe(0);
    expect(preview.employeesCreated).toBe(5);
    expect(preview.assignmentsCreated).toBe(5);
    expect(preview.supervisorsLinked).toBe(2);
    expect(preview.teamsSummary.length).toBe(3);

    // Verify DB was NOT mutated
    const teamsBefore = await workforce.listTeams(adminActor);
    const existingCobranzas = teamsBefore.items.find(t => t.name === 'Cobranzas Early');
    expect(existingCobranzas).toBeUndefined();

    // 2. Real execution (dryRun: false)
    const execution = await workforce.importTeamsFromExcel(
      adminActor,
      {
        filename: 'roster_import_test.csv',
        base64Content,
        defaultWeekId: week.id,
        dryRun: false,
      },
      randomUUID()
    );

    expect(execution.dryRun).toBe(false);
    expect(execution.teamsCreated).toBe(3);
    expect(execution.employeesCreated).toBe(5);
    expect(execution.assignmentsCreated).toBe(5);
    expect(execution.supervisorsLinked).toBe(2);

    // Verify teams in DB
    const teamsAfter = await workforce.listTeams(adminActor);
    const cobranzasTeam = teamsAfter.items.find(t => t.name === 'Cobranzas Early');
    const retencionesTeam = teamsAfter.items.find(t => t.name === 'Retenciones VIP');
    const emptyTeam = teamsAfter.items.find(t => t.name === 'Equipo Vacio Sin Agentes');

    expect(cobranzasTeam).toBeDefined();
    expect(retencionesTeam).toBeDefined();
    expect(emptyTeam).toBeDefined();

    // Verify employees created with BMS ID, Wave and normalized name
    const elenaEmp = (await workforce.listEmployees(adminActor, { search: 'AG-COB-10' })).items[0];
    expect(elenaEmp).toBeDefined();
    expect(elenaEmp?.firstName).toBe('Elena');
    expect(elenaEmp?.bmsId).toBe('BMS-881');
    expect(elenaEmp?.wave).toBe('Wave 14');
    expect(elenaEmp?.normalizedName).toBe('ELENA RIOS');
    expect(elenaEmp?.currentTeamName).toBe('Cobranzas Early');
    expect(elenaEmp?.currentManagerName).toBe('Marcos Valle');

    // Verify assignments linked to week
    const elenaAssignments = await workforce.listAssignments(adminActor, elenaEmp!.id);
    expect(elenaAssignments.items.length).toBe(1);
    expect(elenaAssignments.items[0]?.weekId).toBe(week.id);
    expect(elenaAssignments.items[0]?.weekCode).toBe('2026-W38');

    // 3. Idempotency test (re-importing should update/find existing without errors or duplicates)
    const reImport = await workforce.importTeamsFromExcel(
      adminActor,
      {
        filename: 'roster_import_test.csv',
        base64Content,
        defaultWeekId: week.id,
        dryRun: false,
      },
      randomUUID()
    );
    expect(reImport.teamsCreated).toBe(0);
    expect(reImport.teamsFound).toBe(3);
    expect(reImport.employeesCreated).toBe(0);
    expect(reImport.employeesUpdated).toBe(5);

    // 4. Multi-tenant isolation: Tenant B must not see Tenant A's imported teams
    const tenantBTeams = await workforce.listTeams(otherTenantActor);
    expect(tenantBTeams.items.find(t => t.name === 'Cobranzas Early')).toBeUndefined();
  });
});

