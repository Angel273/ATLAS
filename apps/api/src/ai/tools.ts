import { randomUUID } from 'node:crypto';
import type { DataActor, GroundingCitation, ToolExecution } from '@atlas/contracts';
import type { KpiService } from '@atlas/kpi';
import type { IngestionService } from '@atlas/ingestion';
import type { WorkforceService } from '../workforce/workforce.service.js';
import type { DashboardsService } from '../dashboards/dashboards.service.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolServices {
  kpi: KpiService;
  ingestion: IngestionService;
  workforce: WorkforceService;
  dashboards: DashboardsService;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_kpis',
    description: 'Busca KPIs y métricas publicadas en el modelo semántico de la organización por nombre, código slug o descripción.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Término de búsqueda opcional (ej. "fcr", "resolución", "ventas", "satisfacción"). Si está vacío, lista todas las métricas publicadas.',
        },
      },
    },
  },
  {
    name: 'get_kpi_definition',
    description: 'Obtiene la definición detallada de un KPI: fórmula en la DSL segura, datasets origen, metas, umbrales (crítico, advertencia, objetivo) y dimensiones permitidas.',
    parameters: {
      type: 'object',
      properties: {
        slugOrId: {
          type: 'string',
          description: 'Identificador único UUID o código slug del KPI (ej. "fcr_rate", "csat_score").',
        },
      },
      required: ['slugOrId'],
    },
  },
  {
    name: 'describe_dataset',
    description: 'Obtiene el esquema, campos destino, tipos de datos y versiones publicadas de un dataset.',
    parameters: {
      type: 'object',
      properties: {
        datasetId: {
          type: 'string',
          description: 'Identificador UUID del dataset.',
        },
      },
      required: ['datasetId'],
    },
  },
  {
    name: 'describe_relationships',
    description: 'Lista las relaciones semánticas activas entre tablas y datasets del tenant (cardinalidad, campos de unión y dirección de join).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'run_semantic_query',
    description: 'Ejecuta una consulta declarativa sobre un KPI publicado a través del motor semántico de ATLAS, con dimensiones y filtros temporales.',
    parameters: {
      type: 'object',
      properties: {
        kpiVersionId: {
          type: 'string',
          description: 'UUID de la versión de KPI a consultar.',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista opcional de dimensiones de agrupación (ej. ["channel", "agent_id"]).',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
              value: { type: 'string' },
            },
            required: ['field', 'op', 'value'],
          },
          description: 'Filtros opcionales para la consulta.',
        },
        timeRange: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
          required: ['field'],
          description: 'Rango de fechas para filtrar la consulta.',
        },
        limit: {
          type: 'integer',
          description: 'Cantidad máxima de filas (por defecto 20).',
        },
      },
      required: ['kpiVersionId'],
    },
  },
  {
    name: 'get_employee_structure',
    description: 'Consulta la estructura de workforce de la organización: equipos operativos, tipos de rol y conteo o lista de agentes.',
    parameters: {
      type: 'object',
      properties: {
        teamId: {
          type: 'string',
          description: 'Filtrar opcionalmente por UUID de equipo.',
        },
      },
    },
  },
  {
    name: 'get_published_dashboard',
    description: 'Consulta un dashboard publicado y las definiciones de los widgets que contiene.',
    parameters: {
      type: 'object',
      properties: {
        dashboardId: {
          type: 'string',
          description: 'UUID del dashboard.',
        },
      },
      required: ['dashboardId'],
    },
  },
];

export async function executeTool(
  services: ToolServices,
  actor: DataActor,
  conversationId: string,
  toolName: string,
  rawArgs: Record<string, unknown>,
  correlationId: string
): Promise<{
  result: Record<string, unknown>;
  citations: GroundingCitation[];
  execution: Omit<ToolExecution, 'id' | 'createdAt'>;
}> {
  const started = Date.now();
  const citations: GroundingCitation[] = [];
  let status: 'success' | 'error' = 'success';
  let result: Record<string, unknown> = {};

  try {
    switch (toolName) {
      case 'search_kpis': {
        const query = typeof rawArgs.query === 'string' ? rawArgs.query.toLowerCase().trim() : '';
        const list = await services.kpi.list(actor);
        const filtered = list.items.filter(k => {
          if (!k.publishedAt || k.deprecatedAt) return false;
          if (!query) return true;
          return k.name.toLowerCase().includes(query) || k.slug.toLowerCase().includes(query) || k.description.toLowerCase().includes(query);
        });

        result = {
          count: filtered.length,
          kpis: filtered.map(k => ({
            id: k.id,
            slug: k.slug,
            name: k.name,
            description: k.description,
            unit: k.unit,
            precision: k.precision,
            targetDirection: k.targetDirection,
            targets: k.targets,
            dimensions: k.dimensions,
          })),
        };

        for (const k of filtered.slice(0, 5)) {
          citations.push({
            kpiVersionId: k.id,
            kpiSlug: k.slug,
            title: `KPI: ${k.name} (v${k.number})`,
            factType: 'calculation',
          });
        }
        break;
      }

      case 'get_kpi_definition': {
        const slugOrId = String(rawArgs.slugOrId || '').trim();
        const list = await services.kpi.list(actor);
        const found = list.items.find(k => k.id === slugOrId || k.slug.toLowerCase() === slugOrId.toLowerCase());
        if (!found) {
          result = { error: `No se encontró el KPI con identificador o slug '${slugOrId}'.` };
          status = 'error';
        } else {
          result = {
            id: found.id,
            slug: found.slug,
            name: found.name,
            description: found.description,
            number: found.number,
            formula: found.formula,
            unit: found.unit,
            precision: found.precision,
            targetDirection: found.targetDirection,
            targets: found.targets,
            dimensions: found.dimensions,
            dependencies: found.dependencies,
            publishedAt: found.publishedAt,
          };
          citations.push({
            kpiVersionId: found.id,
            kpiSlug: found.slug,
            title: `Definición de KPI: ${found.name}`,
            factType: 'calculation',
          });
        }
        break;
      }

      case 'describe_dataset': {
        const datasetId = String(rawArgs.datasetId || '').trim();
        const datasets = await services.ingestion.list(actor);
        const ds = datasets.items.find(d => d.id === datasetId || d.slug === datasetId);
        if (!ds) {
          result = { error: `Dataset '${datasetId}' no encontrado.` };
          status = 'error';
        } else {
          const versions = await services.ingestion.versions(actor, ds.id);
          const current = versions.items.find(v => v.id === ds.currentVersionId) || versions.items[0];
          result = {
            id: ds.id,
            slug: ds.slug,
            name: ds.name,
            currentVersionId: ds.currentVersionId,
            fields: current?.mapping?.fields || [],
            rowCount: current?.rows || 0,
            publishedAt: current?.publishedAt,
          };
          citations.push({
            datasetVersionId: current?.id,
            datasetSlug: ds.slug,
            title: `Dataset: ${ds.name}`,
            factType: 'fact',
          });
        }
        break;
      }

      case 'describe_relationships': {
        const rels = await services.kpi.listRelationships(actor);
        result = {
          count: rels.items.length,
          relationships: rels.items.map(r => ({
            id: r.id,
            fromDatasetId: r.fromDatasetId,
            fromField: r.fromField,
            toDatasetId: r.toDatasetId,
            toField: r.toField,
            cardinality: r.cardinality,
            joinType: r.joinType,
            isPreferred: r.isPreferred,
          })),
        };
        citations.push({
          title: `Relaciones Semánticas (${rels.items.length} activas)`,
          factType: 'structure',
        });
        break;
      }

      case 'run_semantic_query': {
        const kpiVersionId = String(rawArgs.kpiVersionId || '').trim();
        const dimensions = Array.isArray(rawArgs.dimensions) ? rawArgs.dimensions.map(String) : [];
        const filters = Array.isArray(rawArgs.filters) ? rawArgs.filters : [];
        const timeRange = rawArgs.timeRange && typeof rawArgs.timeRange === 'object' ? rawArgs.timeRange : undefined;
        const limit = typeof rawArgs.limit === 'number' ? Math.min(Math.max(1, rawArgs.limit), 50) : 20;

        const queryRes = await services.kpi.query(
          actor,
          {
            kpiVersionId,
            dimensions,
            filters,
            timeRange,
            limit,
          },
          correlationId
        );

        result = {
          kpiVersionId: queryRes.kpiVersionId,
          queryHash: queryRes.queryHash,
          rowCount: queryRes.rows.length,
          rows: queryRes.rows,
          targetEvaluation: queryRes.targetEvaluation,
          warnings: queryRes.warnings,
          joinPath: queryRes.joinPath,
        };

        citations.push({
          kpiVersionId: queryRes.kpiVersionId,
          datasetVersionId: queryRes.datasetVersionId,
          queryHash: queryRes.queryHash,
          timeRange: timeRange as { from?: string; to?: string } | undefined,
          title: `Consulta Semántica (Hash: ${queryRes.queryHash.slice(0, 8)})`,
          factType: 'calculation',
        });
        break;
      }

      case 'get_employee_structure': {
        const teams = await services.workforce.listTeams(actor);
        const employees = await services.workforce.listEmployees(actor);
        const teamFilter = typeof rawArgs.teamId === 'string' ? rawArgs.teamId : undefined;

        const filteredEmployees = teamFilter
          ? employees.items.filter(e => e.currentTeamId === teamFilter)
          : employees.items;

        result = {
          teamCount: teams.items.length,
          teams: teams.items.map(t => ({ id: t.id, name: t.name, slug: t.slug })),
          totalEmployees: filteredEmployees.length,
          sampleEmployees: filteredEmployees.slice(0, 10).map(e => ({
            id: e.id,
            code: e.code,
            displayName: `${e.firstName} ${e.lastName}`,
            status: e.status,
            teamId: e.currentTeamId,
            teamName: e.currentTeamName,
          })),
        };

        citations.push({
          title: `Estructura de Workforce (${teams.items.length} equipos, ${filteredEmployees.length} colaboradores)`,
          factType: 'structure',
        });
        break;
      }

      case 'get_published_dashboard': {
        const dashboardId = String(rawArgs.dashboardId || '').trim();
        const dash = await services.dashboards.get(actor, dashboardId);
        result = {
          id: dash.id,
          name: dash.name,
          slug: dash.slug,
          version: dash.currentVersion ? {
            title: dash.currentVersion.title,
            widgetCount: dash.currentVersion.layout.length,
            widgets: dash.currentVersion.layout.map(w => ({
              id: w.id,
              type: w.type,
              title: w.title,
              kpiVersionId: w.kpiVersionId,
            })),
          } : null,
        };

        citations.push({
          title: `Dashboard: ${dash.name}`,
          factType: 'fact',
        });
        break;
      }

      default:
        result = { error: `Herramienta desconocida: ${toolName}` };
        status = 'error';
    }
  } catch (err: unknown) {
    status = 'error';
    const msg = err instanceof Error ? err.message : 'Error al ejecutar herramienta';
    result = { error: msg };
  }

  const durationMs = Date.now() - started;

  return {
    result,
    citations,
    execution: {
      conversationId,
      toolName,
      parametersRedacted: sanitizeArgs(rawArgs),
      resultSummary: summarizeResult(result),
      durationMs,
      status,
    },
  };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('key') || k.toLowerCase().includes('password')) {
      safe[k] = '[REDACTADO]';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

function summarizeResult(res: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(res)) {
    if (Array.isArray(v)) {
      summary[`${k}_count`] = v.length;
      if (v.length > 0 && typeof v[0] === 'object') {
        summary[`${k}_sample`] = v.slice(0, 3);
      }
    } else if (typeof v === 'object' && v !== null) {
      summary[k] = '[object]';
    } else {
      summary[k] = v;
    }
  }
  return summary;
}
