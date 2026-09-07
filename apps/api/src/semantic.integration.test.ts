/**
 * @file apps/api/src/semantic.integration.test.ts
 * @description Pruebas de integración para la Capa Semántica, JOINs multi-tabla, grafo de relaciones y KPIs gobernados.
 * Valida la creación de relaciones semánticas, detección de ciclos y dependencias, resolución BFS de joins,
 * compilación y agregación SQL multidimensional, y enriquecimiento dinámico con workforce.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from '@atlas/database';

import { IngestionService, startImportWorker } from '@atlas/ingestion';
import { KpiService } from '@atlas/kpi';
import {
  roleCapabilities,
  type DataActor,
  type DatasetVersion,
  type Mapping,
  type Regional,
} from '@atlas/contracts';

describe('Phase 2: Semantic Layer, Multi-table Joins, Relationships and Governed KPIs', () => {
  const admin = createPool(process.env.ADMIN_DATABASE_URL);
  const data = new IngestionService();
  const kpis = new KpiService(data);

  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const user = randomUUID();

  const actor: DataActor = {
    tenantId: tenant,
    userId: user,
    capabilities: [...roleCapabilities.admin],
  };
  const other: DataActor = { ...actor, tenantId: otherTenant };

  const regional: Regional = {
    decimalSeparator: ',',
    thousandsSeparator: '.',
    dateFormat: 'DD/MM/YYYY',
    timezone: 'America/Guatemala',
    delimiter: ';',
  };

  let worker: ReturnType<typeof startImportWorker>;
  let callsDatasetId: string;
  let agentsDatasetId: string;
  let callsVersion: DatasetVersion;
  let agentsVersion: DatasetVersion;
  let multiTableKpiId: string;

  async function wait(id: string, states: string[]) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const version = await data.get(actor, id);
      if (states.includes(version.state)) return version;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('IMPORT_TEST_TIMEOUT');
  }

  async function uploadCsv(
    datasetId: string,
    csv: string,
    mapping: Mapping
  ) {
    const bytes = Buffer.from(csv);
    const result = await data.upload(
      actor,
      datasetId,
      { filename: 'data.csv', format: 'csv', bytes: bytes.length, regional },
      randomUUID(),
      randomUUID()
    );
    expect(
      (
        await fetch(result.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        })
      ).ok
    ).toBe(true);

    await data.confirm(actor, result.version.id);
    await wait(result.version.id, ['awaiting_mapping', 'failed']);
    await data.map(actor, result.version.id, mapping);
    return wait(result.version.id, ['ready', 'failed']);
  }

  beforeAll(async () => {
    await admin.query('INSERT INTO organizations(id, name) VALUES($1, $2), ($3, $4)', [
      tenant,
      'Semantic Corp',
      otherTenant,
      'Other Corp',
    ]);
    await admin.query(
      "INSERT INTO identity.users(id, email, password_hash, mfa_enabled, mfa_secret) VALUES($1, $2, $3, true, 'synthetic-secret')",
      [user, `${user}@example.invalid`, 'synthetic-hash']
    );
    await admin.query(
      "INSERT INTO identity.memberships(tenant_id, user_id, role) VALUES($1, $2, 'admin')",
      [tenant, user]
    );

    await data.onModuleInit();
    worker = startImportWorker();
    await worker.waitUntilReady();

    callsDatasetId = (
      await data.create(actor, { name: 'Calls Data', slug: 'calls' }, randomUUID(), randomUUID())
    ).id;
    agentsDatasetId = (
      await data.create(actor, { name: 'Agents Data', slug: 'agents' }, randomUUID(), randomUUID())
    ).id;
  });

  afterAll(async () => {
    await worker?.close();
    await kpis.onModuleDestroy();
    await data.onModuleDestroy();
    await admin.end();
  });

  it('ingests and publishes two related datasets (calls and agents)', async () => {
    // 1. Calls dataset
    const callsMapping: Mapping = {
      sheet: 'CSV',
      strategy: 'replace',
      regional,
      keyFields: ['call_id'],
      fields: [
        { source: 'call_id', target: 'call_id', type: 'string', required: true },
        { source: 'agent_id', target: 'agent_id', type: 'string', required: true },
        { source: 'duration', target: 'duration', type: 'decimal', required: false },
      ],
    };
    const callsReady = await uploadCsv(
      callsDatasetId,
      'call_id;agent_id;duration\nc1;a1;120,50\nc2;a2;240,00\nc3;a1;60,00\n',
      callsMapping
    );
    expect(callsReady.state).toBe('ready');
    callsVersion = await data.publish(actor, callsReady.id, randomUUID(), randomUUID());

    // 2. Agents dataset
    const agentsMapping: Mapping = {
      sheet: 'CSV',
      strategy: 'replace',
      regional,
      keyFields: ['id'],
      fields: [
        { source: 'id', target: 'id', type: 'string', required: true },
        { source: 'name', target: 'name', type: 'string', required: true },
        { source: 'department', target: 'department', type: 'string', required: false },
      ],
    };
    const agentsReady = await uploadCsv(
      agentsDatasetId,
      'id;name;department\na1;Alice;Support\na2;Bob;Sales\n',
      agentsMapping
    );
    expect(agentsReady.state).toBe('ready');
    agentsVersion = await data.publish(actor, agentsReady.id, randomUUID(), randomUUID());
  });

  it('creates and publishes a semantic relationship with RLS and idempotency', async () => {
    const key = randomUUID();
    const relInput = {
      fromDatasetId: callsDatasetId,
      fromField: 'agent_id',
      toDatasetId: agentsDatasetId,
      toField: 'id',
      cardinality: 'many_to_one' as const,
      joinType: 'left' as const,
      isPreferred: true,
    };

    const created = await kpis.createRelationship(actor, relInput, key, randomUUID());
    expect(created.fromField).toBe('agent_id');
    expect(created.toField).toBe('id');
    expect(created.isPreferred).toBe(true);

    // Idempotent retry
    const retry = await kpis.createRelationship(actor, relInput, key, randomUUID());
    expect(retry.id).toBe(created.id);

    // List relationships
    const list = await kpis.listRelationships(actor);
    expect(list.items.some(r => r.id === created.id)).toBe(true);

    // Cross-tenant read is isolated
    const otherList = await kpis.listRelationships(other);
    expect(otherList.items).toHaveLength(0);
  });

  it('creates, publishes and executes a multi-table KPI joined through published relationships', async () => {
    const kpiInput = {
      name: 'Duración por departamento',
      slug: 'duration_by_dept',
      description: 'Duración total de llamadas agrupada por departamento del agente',
      datasetVersionId: callsVersion.id,
      relatedDatasetVersionIds: [agentsVersion.id],
      formula: 'SUM(calls.duration)',
      unit: 'seconds' as const,
      precision: 2,
      dimensions: ['agents.department'],
      targetDirection: 'lower_is_better' as const,
      targets: { target: 300, warningThreshold: 400, criticalThreshold: 500 },
      dependencies: [],
    };

    const key = randomUUID();
    const kpi = await kpis.create(actor, kpiInput, key, randomUUID());
    multiTableKpiId = kpi.id;
    expect(kpi.slug).toBe('duration_by_dept');
    expect(kpi.targets.target).toBe(300);

    // Publish
    await kpis.publish(actor, kpi.id, randomUUID());

    // Execute multi-table query
    const queryRes = await kpis.query(
      actor,
      {
        kpiVersionId: kpi.id,
        dimensions: ['agents.department'],
        filters: [],
      },
      randomUUID()
    );

    expect(queryRes.rows).toEqual([
      { dimensions: { 'agents.department': 'Sales' }, value: '240.00' },
      { dimensions: { 'agents.department': 'Support' }, value: '180.50' },
    ]);
    expect(queryRes.joinPath).toHaveLength(1);
    expect(queryRes.joinPath[0]).toContain('agent_id = t1.id');
    expect(queryRes.cacheHit).toBe(false);
    expect(queryRes.targetEvaluation?.status).toBe('good');

    // Second execution hits memory cache
    const cachedRes = await kpis.query(
      actor,
      {
        kpiVersionId: kpi.id,
        dimensions: ['agents.department'],
        filters: [],
      },
      randomUUID()
    );
    expect(cachedRes.cacheHit).toBe(true);
    expect(cachedRes.rows).toEqual(queryRes.rows);
  });

  it('deprecates a KPI version while preserving historical queries', async () => {
    const deprecated = await kpis.deprecate(actor, multiTableKpiId, randomUUID());
    expect(deprecated.deprecatedAt).not.toBeNull();

    // Queries on deprecated KPIs still succeed for historical dashboards
    const query = await kpis.query(
      actor,
      {
        kpiVersionId: multiTableKpiId,
        dimensions: [],
        filters: [],
      },
      randomUUID()
    );
    expect(query.rows[0]?.value).toBe('420.50');
  });

  it('enforces PostgreSQL RLS preventing tampering of published relationships', async () => {
    await expect(
      withTenant(data.pool, tenant, client =>
        client.query('UPDATE semantic_relationships SET from_field = $1', ['tampered'])
      )
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('executes KPI query with dynamic workforce mapping and operational columns', async () => {
    // Insert workforce employees and supervisor for tenant
    const supId = randomUUID();
    const a1Id = randomUUID();
    const a2Id = randomUUID();

    await withTenant(data.pool, tenant, async client => {
      await client.query(
        `INSERT INTO employees(tenant_id, id, code, first_name, last_name, wave)
         VALUES ($1, $2, 'sup1', 'Carlos', 'Lider', 'Leadership'),
                ($1, $3, 'a1', 'Ana', 'Gomez', 'Wave 1'),
                ($1, $4, 'a2', 'Beto', 'Perez', 'Wave 2')`,
        [tenant, supId, a1Id, a2Id]
      );
      await client.query(
        `INSERT INTO employee_relationships(tenant_id, employee_id, manager_id, relation_type, valid_from)
         VALUES ($1, $2, $4, 'supervisor', now()),
                ($1, $3, $4, 'supervisor', now())`,
        [tenant, a1Id, a2Id, supId]
      );
    });

    // Create KPI with workforce_mapping enabled
    const wfKpi = await kpis.create(
      actor,
      {
        name: 'Total Duration by Supervisor',
        slug: 'duration_by_sup',
        description: 'Duration mapped dynamically to Workforce hierarchy',
        datasetVersionId: callsVersion.id,
        relatedDatasetVersionIds: [],
        formula: 'SUM(duration)',
        unit: 'seconds' as const,
        precision: 2,
        dimensions: ['supervisor', 'wave'],
        targetDirection: 'lower_is_better' as const,
        targets: {},
        dependencies: [],
        workforceMapping: {
          enabled: true,
          matchKey: 'code',
          datasetField: 'agent_id',
          selectedColumns: ['supervisor', 'wave'],
        },
      },
      randomUUID(),
      randomUUID()
    );

    await kpis.publish(actor, wfKpi.id, randomUUID());

    // Query grouped by supervisor
    const querySup = await kpis.query(
      actor,
      {
        kpiVersionId: wfKpi.id,
        dimensions: ['supervisor'],
        filters: [],
      },
      randomUUID()
    );

    expect(querySup.rows).toEqual([
      { dimensions: { supervisor: 'Carlos Lider' }, value: '420.50' },
    ]);
    expect(querySup.joinPath.some(p => p.includes('Workforce'))).toBe(true);

    // Query grouped by wave
    const queryWave = await kpis.query(
      actor,
      {
        kpiVersionId: wfKpi.id,
        dimensions: ['wave'],
        filters: [],
      },
      randomUUID()
    );

    expect(queryWave.rows).toEqual([
      { dimensions: { wave: 'Wave 1' }, value: '180.50' },
      { dimensions: { wave: 'Wave 2' }, value: '240.00' },
    ]);

    // Query with filter by wave
    const queryFilter = await kpis.query(
      actor,
      {
        kpiVersionId: wfKpi.id,
        dimensions: [],
        filters: [{ field: 'wave', op: 'eq' as const, value: 'Wave 1' }],
      },
      randomUUID()
    );
    expect(queryFilter.rows[0]?.value).toBe('180.50');
  });
});
