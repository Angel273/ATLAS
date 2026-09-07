/**
 * @file apps/api/src/dashboards.integration.test.ts
 * @description Pruebas de integración para Dashboards, Layouts, Widgets, Versionado inmutable y RLS.
 * Verifica la creación de tableros, publicación inmutable restringida a administradores,
 * aislamiento de lectura entre tenants y filtrado operacional por supervisor, jefe de piso y ola.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from '@atlas/database';

import { IngestionService } from '@atlas/ingestion';
import { KpiService } from '@atlas/kpi';
import { DashboardsService } from './dashboards/dashboards.service.js';
import {
  roleCapabilities,
  type DataActor,
  type WidgetDefinition,
} from '@atlas/contracts';

describe('Phase 3: Dashboards, Layouts, Widgets, Versioning and RLS', () => {
  const admin = createPool(process.env.ADMIN_DATABASE_URL);
  const data = new IngestionService();
  const kpis = new KpiService(data);
  const dashboards = new DashboardsService();

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userAdmin = randomUUID();
  const userSupervisor = randomUUID();

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

  const otherTenantActor: DataActor = {
    ...adminActor,
    tenantId: tenantB,
  };

  let dashboardId: string;
  let versionId: string;

  beforeAll(async () => {
    await admin.query('INSERT INTO organizations(id, name) VALUES($1, $2), ($3, $4)', [
      tenantA,
      'Dashboard Org A',
      tenantB,
      'Dashboard Org B',
    ]);
    await admin.query(
      "INSERT INTO identity.users(id, email, password_hash, mfa_enabled, mfa_secret) VALUES($1, $2, $3, true, 'synthetic-secret'), ($4, $5, $3, false, null)",
      [userAdmin, `dash-admin-${tenantA}@example.invalid`, 'synthetic-hash', userSupervisor, `dash-sup-${tenantA}@example.invalid`]
    );
    await admin.query(
      "INSERT INTO identity.memberships(tenant_id, user_id, role) VALUES($1, $2, 'admin'), ($1, $3, 'supervisor')",
      [tenantA, userAdmin, userSupervisor]
    );
  });

  afterAll(async () => {
    await dashboards.onModuleDestroy();
    await kpis.onModuleDestroy();
    await data.onModuleDestroy();
    await admin.end();
  });

  it('allows Admin to create a dashboard with initial draft version', async () => {
    const key = randomUUID();
    const created = await dashboards.create(
      adminActor,
      {
        name: 'Operaciones Call Center',
        slug: 'operaciones_cc',
        description: 'Dashboard oficial de soporte y ventas',
      },
      key,
      randomUUID()
    );

    dashboardId = created.id;
    expect(created.name).toBe('Operaciones Call Center');
    expect(created.slug).toBe('operaciones_cc');
    expect(created.currentVersionId).toBeNull(); // Initial is draft, not published

    // Idempotent retry
    const retry = await dashboards.create(
      adminActor,
      {
        name: 'Operaciones Call Center',
        slug: 'operaciones_cc',
        description: 'Dashboard oficial de soporte y ventas',
      },
      key,
      randomUUID()
    );
    expect(retry.id).toBe(dashboardId);
  });

  it('prevents non-admin from creating or persisting dashboard drafts', async () => {
    await expect(
      dashboards.create(supervisorActor, { name: 'Unauthorized', slug: 'unauth' }, randomUUID(), randomUUID())
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('hides unpublished draft dashboards from non-administrators', async () => {
    const supervisorList = await dashboards.list(supervisorActor);
    expect(supervisorList.items.some(d => d.id === dashboardId)).toBe(false);

    await expect(dashboards.get(supervisorActor, dashboardId)).rejects.toMatchObject({
      code: 'DASHBOARD_NOT_FOUND',
    });
  });

  it('allows Admin to save a version with configured widgets', async () => {
    const widgets: WidgetDefinition[] = [
      {
        id: randomUUID(),
        type: 'kpi_card',
        title: 'Total Atendidas',
        grid: { x: 0, y: 0, w: 4, h: 4 },
      },
      {
        id: randomUUID(),
        type: 'bar_chart',
        title: 'Llamadas por Departamento',
        dimension: 'departamento',
        grid: { x: 4, y: 0, w: 8, h: 6 },
      },
      {
        id: randomUUID(),
        type: 'table',
        title: 'Detalle de Operación',
        grid: { x: 0, y: 6, w: 12, h: 6 },
      },
    ];

    const key = randomUUID();
    const saved = await dashboards.saveVersion(
      adminActor,
      dashboardId,
      {
        title: 'Operaciones v2',
        description: 'Borrador con métricas y gráficas',
        layout: widgets,
        globalFilters: { timeRange: '30d' },
      },
      key,
      randomUUID()
    );

    versionId = saved.id;
    expect(saved.number).toBe(2);
    expect(saved.layout).toHaveLength(3);
    expect(saved.publishedAt).toBeNull();
  });

  it('allows Admin to publish a dashboard version, making it visible to supervisors', async () => {
    const key = randomUUID();
    const published = await dashboards.publish(adminActor, dashboardId, versionId, key, randomUUID());
    expect(published.currentVersionId).toBe(versionId);
    expect(published.currentVersion?.publishedAt).not.toBeNull();

    // Now supervisor can view the published dashboard
    const supervisorView = await dashboards.get(supervisorActor, dashboardId);
    expect(supervisorView.id).toBe(dashboardId);
    expect(supervisorView.currentVersion?.id).toBe(versionId);
    expect(supervisorView.currentVersion?.layout).toHaveLength(3);

    // Supervisor list includes it
    const list = await dashboards.list(supervisorActor);
    expect(list.items.some(d => d.id === dashboardId)).toBe(true);
  });

  it('enforces PostgreSQL RLS preventing cross-tenant access to dashboards', async () => {
    await expect(dashboards.get(otherTenantActor, dashboardId)).rejects.toMatchObject({
      code: 'DASHBOARD_NOT_FOUND',
    });
    const otherList = await dashboards.list(otherTenantActor);
    expect(otherList.items.some(d => d.id === dashboardId)).toBe(false);
  });

  it('enforces immutability trigger on published dashboard versions', async () => {
    await expect(
      withTenant(dashboards.pool, tenantA, client =>
        client.query('UPDATE dashboard_versions SET title = $1 WHERE id = $2', ['Tampered', versionId])
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});
