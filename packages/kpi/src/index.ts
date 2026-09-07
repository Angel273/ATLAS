/**
 * @file packages/kpi/src/index.ts
 * @description Servicio principal de KPIs y Capa Semántica para ATLAS (@atlas/kpi).
 * Gestiona el ciclo de vida de relaciones semánticas entre datasets, la definición y versionado
 * inmutable de métricas operacionales (v1, v2...), validación de dependencias circulares,
 * compilación y ejecución de consultas analíticas declarativas con soporte para agregaciones,
 * caché en memoria por huella digital (fingerprint) y enriquecimiento dinámico con dimensiones laborales (Workforce).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPool, withTenant, withAccount, type Pool, type PoolClient } from '@atlas/database';
import {
  DomainError,
  kpiCreateSchema,
  kpiSchema,
  kpiListSchema,
  querySchema,
  queryResultSchema,
  semanticRelationshipCreateSchema,
  semanticRelationshipSchema,
  semanticRelationshipListSchema,
  type DataActor,
  type SourceField,
} from '@atlas/contracts';
import { IngestionService, permit, audit, normalize } from '@atlas/ingestion';
import { parseFormula, compileFormula, extractReferencedTables, type TableContext } from './dsl.js';
import { resolveJoinPaths, detectKpiCycles, evaluateTarget, type RelationshipRecord, type DatasetNode, type ResolvedJoin } from './relations.js';

export { parseFormula, compileFormula, extractReferencedTables } from './dsl.js';
export { resolveJoinPaths, detectKpiCycles, evaluateTarget } from './relations.js';

class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maxEntries: number = 500) {}

  get(key: K): V | undefined {
    const item = this.map.get(key);
    if (item !== undefined) {
      this.map.delete(key);
      this.map.set(key, item);
    }
    return item;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

function execute<T>(pool: Pool, actor: DataActor, action: (client: PoolClient) => Promise<T>): Promise<T> {
  if (actor.accountId) {
    return withAccount(pool, actor.tenantId, actor.accountId, action);
  }
  return withTenant(pool, actor.tenantId, action);
}

const select = `SELECT id, account_id AS "accountId", name, slug, description, number, model_version_id AS "modelVersionId", dataset_version_id AS "datasetVersionId", formula, unit, precision, dimensions, target_direction AS "targetDirection", targets, dependencies, COALESCE(workforce_mapping, '{"enabled": false, "matchKey": "code", "datasetField": "", "selectedColumns": []}'::jsonb) AS "workforceMapping", deprecated_at::text AS "deprecatedAt", published_at::text AS "publishedAt", created_at::text AS "createdAt" FROM kpi_versions`;
const relSelect = `SELECT id, account_id AS "accountId", from_dataset_id AS "fromDatasetId", from_field AS "fromField", to_dataset_id AS "toDatasetId", to_field AS "toField", cardinality, join_type AS "joinType", is_preferred AS "isPreferred", published_at::text AS "publishedAt", created_at::text AS "createdAt" FROM semantic_relationships`;

/**
 * Servicio central para el catálogo de métricas, relaciones semánticas y ejecución de consultas.
 */
export class KpiService {
  readonly pool = createPool(process.env.DATABASE_URL);
  private readonly queryCache = new LruCache<string, { result: z.infer<typeof queryResultSchema>; expiresAt: number }>(500);

  constructor(private readonly ingestion: IngestionService) {}

  /**
   * Cierra el pool de conexiones y libera recursos al destruir el módulo.
   */
  async onModuleDestroy() {
    this.queryCache.clear();
    await this.pool.end();
  }

  // --- Semantic Relationships ---

  /**
   * Obtiene la lista de relaciones semánticas publicadas en el tenant y cuenta autenticados.
   *
   * @param actor Contexto del usuario autenticado con capacidades.
   * @returns Lista de relaciones semánticas validadas.
   */
  async listRelationships(actor: DataActor) {
    permit(actor, 'semantic.read');
    return execute(this.pool, actor, async client => {
      const rows = (await client.query(`${relSelect} ORDER BY created_at DESC LIMIT 100`)).rows;
      return semanticRelationshipListSchema.parse({ items: rows });
    });
  }

  /**
   * Crea una relación semántica entre dos datasets publicados con cardinalidad y tipo de JOIN definidos.
   * Valida existencia de datasets, pertenencia a la misma cuenta, versiones vigentes y columnas clave.
   *
   * @param actor Contexto del usuario con capacidad `semantic.manage`.
   * @param body Payload con la definición de la relación semántica.
   * @param key Clave de idempotencia única.
   * @param correlation ID de correlación para auditoría.
   */
  async createRelationship(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'semantic.manage');
    const input = semanticRelationshipCreateSchema.parse(body);
    z.uuid().parse(key);

    return execute(this.pool, actor, async client => {
      const previous = (await client.query(`${relSelect} WHERE creation_key = $1`, [key])).rows[0];
      if (previous) return semanticRelationshipSchema.parse(previous);

      if (input.fromDatasetId === input.toDatasetId) {
        throw new DomainError('INVALID_RELATIONSHIP', 400, 'Una relación debe conectar dos datasets distintos.');
      }

      const fromDs = (await client.query<{ id: string; account_id: string; current_version_id: string | null }>(
        'SELECT id, account_id, current_version_id FROM datasets WHERE id = $1',
        [input.fromDatasetId]
      )).rows[0];
      const toDs = (await client.query<{ id: string; account_id: string; current_version_id: string | null }>(
        'SELECT id, account_id, current_version_id FROM datasets WHERE id = $1',
        [input.toDatasetId]
      )).rows[0];

      if (!fromDs || !toDs) {
        throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset de origen o destino no encontrado.');
      }
      if (fromDs.account_id !== toDs.account_id) {
        throw new DomainError('INVALID_RELATIONSHIP', 400, 'Los datasets deben pertenecer a la misma cuenta.');
      }
      if (actor.accountId && actor.accountId !== fromDs.account_id) {
        throw new DomainError('FORBIDDEN', 403, 'Los datasets no pertenecen a la cuenta activa.');
      }
      if (!fromDs.current_version_id || !toDs.current_version_id) {
        throw new DomainError('VERSION_NOT_READY', 400, 'Ambos datasets deben tener una versión publicada vigente.');
      }

      const fromSrc = await this.ingestion.source(client, fromDs.current_version_id);
      const toSrc = await this.ingestion.source(client, toDs.current_version_id);

      const fromFieldDef = fromSrc.version.mapping?.fields.find(f => f.target === input.fromField);
      const toFieldDef = toSrc.version.mapping?.fields.find(f => f.target === input.toField);
      if (!fromFieldDef || !toFieldDef) {
        throw new DomainError('INVALID_RELATIONSHIP', 400, 'El campo clave especificado no existe en la versión publicada.');
      }

      if (input.isPreferred) {
        await client.query(
          `UPDATE semantic_relationships SET is_preferred = false
           WHERE ((from_dataset_id = $1 AND to_dataset_id = $2) OR (from_dataset_id = $2 AND to_dataset_id = $1))`,
          [input.fromDatasetId, input.toDatasetId]
        );
      }

      const result = await client.query<{ id: string }>(
        `INSERT INTO semantic_relationships (
          tenant_id, account_id, from_dataset_id, from_field, to_dataset_id, to_field,
          cardinality, join_type, is_preferred, creation_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          actor.tenantId, fromDs.account_id, input.fromDatasetId, input.fromField,
          input.toDatasetId, input.toField, input.cardinality,
          input.joinType, input.isPreferred, key
        ]
      );

      const id = result.rows[0]!.id;
      await audit(client, actor, 'semantic.relationship_created', id, correlation);
      this.queryCache.clear();
      const row = (await client.query(`${relSelect} WHERE id = $1`, [id])).rows[0];
      return semanticRelationshipSchema.parse(row);
    });
  }

  // --- KPIs ---

  /**
   * Lista los KPIs gobernados disponibles para el tenant y cuenta actual.
   * Filtra borradores salvo para usuarios con permisos administrativos `semantic.manage`.
   *
   * @param actor Contexto del usuario solicitante.
   * @param includeDeprecated Si es true, incluye métricas que han sido deprecadas.
   */
  async list(actor: DataActor, includeDeprecated = false) {
    permit(actor, 'semantic.read');
    return execute(this.pool, actor, async client => {
      const conditions: string[] = [];
      if (!actor.capabilities.includes('semantic.manage')) {
        conditions.push('published_at IS NOT NULL');
      }
      if (!includeDeprecated) {
        conditions.push('deprecated_at IS NULL');
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = (await client.query(
        `${select} ${where} ORDER BY created_at DESC LIMIT 100`
      )).rows;
      return kpiListSchema.parse({ items: rows });
    });
  }

  /**
   * Obtiene la definición de un KPI por su ID dentro de la transacción actual.
   *
   * @param client Cliente PostgreSQL activo.
   * @param id Identificador UUID del KPI.
   */
  private async get(client: PoolClient, id: string) {
    const row = (await client.query(`${select} WHERE id = $1`, [z.uuid().parse(id)])).rows[0];
    if (!row) throw new DomainError('KPI_NOT_FOUND', 404, 'KPI no encontrado.');
    return kpiSchema.parse(row);
  }

  /**
   * Crea una nueva versión inmutable de KPI (borrador) validando la sintaxis de la fórmula,
   * compatibilidad de dimensiones, ciclo de dependencias y mapeo de workforce.
   *
   * @param actor Contexto del usuario autenticado con rol de gestión.
   * @param body Payload de creación de KPI.
   * @param key Clave única de idempotencia.
   * @param correlation Correlation ID para auditoría.
   */
  async create(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'semantic.manage');
    const input = kpiCreateSchema.parse(body);
    z.uuid().parse(key);

    return execute(this.pool, actor, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor.tenantId}:${actor.accountId ?? ''}:${input.slug}`]);
      const previous = (await client.query('SELECT id FROM kpi_versions WHERE creation_key = $1', [key])).rows[0];
      if (previous) {
        const old = await this.get(client, String(previous.id));
        if (
          old.name !== input.name ||
          old.slug !== input.slug ||
          old.formula !== input.formula ||
          old.datasetVersionId !== input.datasetVersionId
        ) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 409, 'La solicitud ya se utilizó con otra definición.');
        }
        return old;
      }

      // Check circular KPI dependencies
      if (input.dependencies.length > 0) {
        const existingKpis = (await client.query<{ slug: string; dependencies: string[] }>(
          'SELECT slug, dependencies FROM kpi_versions WHERE published_at IS NOT NULL'
        )).rows;
        const depMap = new Map<string, string[]>();
        for (const k of existingKpis) depMap.set(k.slug, k.dependencies ?? []);
        detectKpiCycles(input.slug, input.dependencies, depMap);
      }

      // Base dataset source
      const source = await this.ingestion.source(client, input.datasetVersionId);
      if (source.dataset.archivedAt) {
        throw new DomainError('DATASET_ARCHIVED', 400, 'No se pueden crear KPIs sobre un dataset archivado.');
      }
      const accountId = actor.accountId || source.dataset.accountId;
      if (!accountId) {
        throw new DomainError('ACCOUNT_REQUIRED', 400, 'Se requiere una cuenta activa para crear KPIs.');
      }

      const tables: TableContext[] = [
        { slug: source.dataset.slug, alias: 'source', fields: source.version.mapping!.fields }
      ];

      // Related datasets
      for (const relVersionId of input.relatedDatasetVersionIds) {
        const relSource = await this.ingestion.source(client, relVersionId);
        tables.push({
          slug: relSource.dataset.slug,
          alias: `t${tables.length}`,
          fields: relSource.version.mapping!.fields,
        });
      }

      // Validate dimensions
      const allTargetFields = new Set<string>();
      for (const t of tables) {
        for (const f of t.fields) {
          allTargetFields.add(f.target);
          allTargetFields.add(`${t.slug}.${f.target}`);
        }
      }
      if (input.workforceMapping?.enabled) {
        const wfCols = input.workforceMapping.selectedColumns || ['supervisor', 'floor_manager', 'wave', 'tenure'];
        for (const c of wfCols) {
          allTargetFields.add(c);
          allTargetFields.add(`workforce.${c}`);
        }
        allTargetFields.add('supervisor');
        allTargetFields.add('floor_manager');
        allTargetFields.add('fm');
        allTargetFields.add('wave');
        allTargetFields.add('tenure');
        allTargetFields.add('team');
        allTargetFields.add('week');
        allTargetFields.add('bms_id');
        allTargetFields.add('agent_name');
        allTargetFields.add('agent_code');
      }
      if (new Set(input.dimensions).size !== input.dimensions.length) {
        throw new DomainError('INVALID_DIMENSION', 400, 'Las dimensiones deben ser únicas.');
      }
      for (const dim of input.dimensions) {
        if (!allTargetFields.has(dim)) {
          throw new DomainError('INVALID_DIMENSION', 400, `La dimensión '${dim}' no pertenece a los datasets publicados seleccionados.`);
        }
      }

      const ast = parseFormula(input.formula);
      compileFormula(ast, tables, source.dataset.slug, [input.datasetVersionId]);

      await client.query(
        'INSERT INTO semantic_model_versions(tenant_id, account_id, dataset_version_id, fields) VALUES ($1, $2, $3, $4) ON CONFLICT(tenant_id, dataset_version_id) DO NOTHING',
        [actor.tenantId, accountId, input.datasetVersionId, JSON.stringify(source.version.mapping!.fields)]
      );
      const model = (await client.query<{ id: string }>(
        'SELECT id FROM semantic_model_versions WHERE dataset_version_id = $1',
        [input.datasetVersionId]
      )).rows[0]!;

      const result = await client.query<{ id: string }>(
        `INSERT INTO kpi_versions(
          tenant_id, account_id, slug, number, name, description, model_version_id, dataset_version_id,
          formula, ast, unit, precision, dimensions, target_direction, targets, dependencies,
          workforce_mapping, actor_id, creation_key
        ) VALUES (
          $1, $2, $3::varchar, (SELECT COALESCE(MAX(number), 0) + 1 FROM kpi_versions WHERE slug = $3::varchar AND account_id = $2),
          $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING id`,
        [
          actor.tenantId, accountId, input.slug, input.name, input.description, model.id, input.datasetVersionId,
          input.formula, ast, input.unit, input.precision, JSON.stringify(input.dimensions),
          input.targetDirection, JSON.stringify(input.targets), JSON.stringify(input.dependencies),
          JSON.stringify(input.workforceMapping ?? { enabled: false, matchKey: 'code', datasetField: '', selectedColumns: [] }),
          actor.userId, key
        ]
      );

      const id = result.rows[0]!.id;
      await audit(client, actor, 'kpi.created', id, correlation);
      return this.get(client, id);
    });
  }

  /**
   * Publica un KPI validando que la fórmula ejecute satisfactoriamente sobre los datos reales.
   * Una vez publicado, el KPI se vuelve inmutable y disponible para dashboards y analistas.
   *
   * @param actor Contexto del usuario con capacidad `semantic.publish`.
   * @param id Identificador UUID del KPI.
   * @param correlation ID de correlación para auditoría.
   */
  async publish(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.publish');
    return execute(this.pool, actor, async client => {
      await client.query('SELECT id FROM kpi_versions WHERE id = $1 FOR UPDATE', [z.uuid().parse(id)]);
      const kpi = await this.get(client, id);
      if (!kpi.publishedAt) {
        await this.execute(client, { kpiVersionId: id, dimensions: [], filters: [], limit: 1 });
        await client.query('UPDATE kpi_versions SET published_at = now() WHERE id = $1', [id]);
        await audit(client, actor, 'kpi.published', id, correlation);
        this.queryCache.clear();
      }
      return this.get(client, id);
    });
  }

  /**
   * Marca un KPI publicado como deprecado para ocultarlo de nuevos tableros preservando histórico.
   *
   * @param actor Contexto del usuario con capacidad `semantic.publish`.
   * @param id Identificador UUID del KPI.
   * @param correlation ID de correlación para auditoría.
   */
  async deprecate(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.publish');
    return execute(this.pool, actor, async client => {
      await client.query('SELECT id FROM kpi_versions WHERE id = $1 FOR UPDATE', [z.uuid().parse(id)]);
      const kpi = await this.get(client, id);
      if (!kpi.publishedAt) {
        throw new DomainError('KPI_NOT_PUBLISHED', 400, 'Solo se pueden deprecar KPIs publicados.');
      }
      if (!kpi.deprecatedAt) {
        await client.query('UPDATE kpi_versions SET deprecated_at = now() WHERE id = $1', [id]);
        await audit(client, actor, 'kpi.deprecated', id, correlation);
        this.queryCache.clear();
      }
      return this.get(client, id);
    });
  }

  /**
   * Implementa el ciclo de vida dual para KPIs:
   * - Borradores no publicados sin dependientes: borrado definitivo (Hard Delete).
   * - Métricas publicadas: deprecación lógica preservando linaje y auditoría.
   *
   * @param actor Contexto del usuario con capacidad `semantic.manage`.
   * @param id Identificador UUID del KPI.
   * @param correlation ID de correlación para auditoría.
   */
  async deleteOrDeprecate(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.manage');
    return execute(this.pool, actor, async client => {
      await client.query('SELECT id FROM kpi_versions WHERE id = $1 FOR UPDATE', [z.uuid().parse(id)]);
      const kpi = await this.get(client, id);

      if (kpi.publishedAt) {
        if (!kpi.deprecatedAt) {
          await client.query('UPDATE kpi_versions SET deprecated_at = now() WHERE id = $1', [id]);
          await audit(client, actor, 'kpi.deprecated', id, correlation);
          this.queryCache.clear();
        }
        return { action: 'deprecated' as const, id };
      }

      const dependent = (await client.query<{ slug: string }>(
        'SELECT slug FROM kpi_versions WHERE tenant_id = $1 AND dependencies::jsonb ? $2 LIMIT 1',
        [actor.tenantId, kpi.slug]
      )).rows;
      if (dependent.length > 0) {
        throw new DomainError('KPI_IN_USE', 409, `No se puede eliminar: el KPI ${dependent[0]?.slug ?? 'asociado'} depende de este borrador.`);
      }

      await client.query('DELETE FROM kpi_versions WHERE id = $1', [id]);
      await audit(client, actor, 'kpi.deleted', id, correlation);
      this.queryCache.clear();

      return { action: 'deleted' as const, id };
    });
  }

  /**
   * Ejecuta una consulta analítica multidimensional contra un KPI con caché por fingerprint.
   *
   * @param actor Contexto del usuario solicitante con capacidad `semantic.read`.
   * @param body Payload con KPI, dimensiones, filtros, rango temporal y límite.
   * @param correlation ID de correlación para auditoría.
   */
  async query(actor: DataActor, body: unknown, correlation: string) {
    permit(actor, 'semantic.read');
    const input = querySchema.parse(body);

    const cacheKey = `${actor.tenantId}:${actor.accountId ?? 'all'}:${input.kpiVersionId}:${JSON.stringify(input)}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cacheHit: true };
    }

    try {
      return await execute(this.pool, actor, async client => {
        const kpi = await this.get(client, input.kpiVersionId);
        if (!kpi.publishedAt && !actor.capabilities.includes('semantic.manage')) {
          throw new DomainError('KPI_NOT_FOUND', 404, 'KPI no encontrado.');
        }

        const usesWorkforce = (kpi.workforceMapping?.enabled && kpi.workforceMapping?.datasetField) ||
          input.dimensions.some(d => d.startsWith('workforce.') || ['supervisor', 'floor_manager', 'fm', 'wave', 'tenure', 'team', 'bms_id', 'agent_name', 'agent_code', 'week'].includes(d.toLowerCase())) ||
          input.filters.some(f => f.field.startsWith('workforce.') || ['supervisor', 'floor_manager', 'fm', 'wave', 'tenure', 'team', 'bms_id', 'agent_name', 'agent_code', 'week'].includes(f.field.toLowerCase()));

        if (usesWorkforce) {
          permit(actor, 'workforce.read');
        }

        const result = await this.execute(client, input);
        await audit(client, actor, 'kpi.queried', kpi.id, correlation);

        this.queryCache.set(cacheKey, { result, expiresAt: Date.now() + 60_000 });
        return result;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '57014') {
        throw new DomainError('QUERY_TIMEOUT', 408, 'La consulta superó el tiempo permitido. Reduce los filtros o el periodo.');
      }
      throw error;
    }
  }

  /**
   * Ejecuta el pipeline SQL completo de resolución y agregación:
   * 1. Resuelve joins BFS deterministas entre tablas según el grafo semántico.
   * 2. Inyecta mapeo dinámico de workforce (`workforce_mapping`) si está habilitado.
   * 3. Compila la fórmula del KPI y aplica filtros, dimensiones y rangos temporales.
   * 4. Evalúa las metas operacionales (`evaluateTarget`) asignando estado (good/warning/critical).
   *
   * @param client Cliente PostgreSQL de la transacción con contexto de tenant activo.
   * @param input Parámetros validados de la consulta según `querySchema`.
   */
  private async execute(client: PoolClient, input: z.infer<typeof querySchema>): Promise<z.infer<typeof queryResultSchema>> {

    const kpi = await this.get(client, input.kpiVersionId);
    const rootSource = await this.ingestion.source(client, kpi.datasetVersionId);
    const rootMapping = rootSource.version.mapping!;

    const ast = parseFormula(kpi.formula);
    const referencedTableSlugs = new Set<string>(extractReferencedTables(ast));

    // Extract table slugs from dimensions and filters
    const parseFieldRef = (name: string): { tableSlug: string | undefined; fieldTarget: string } => {
      const parts = name.split('.');
      return parts.length === 2 ? { tableSlug: parts[0], fieldTarget: parts[1]! } : { tableSlug: undefined, fieldTarget: parts[0]! };
    };

    for (const dim of input.dimensions) {
      const { tableSlug } = parseFieldRef(dim);
      if (tableSlug) referencedTableSlugs.add(tableSlug);
    }
    for (const f of input.filters) {
      const { tableSlug } = parseFieldRef(f.field);
      if (tableSlug) referencedTableSlugs.add(tableSlug);
    }
    if (input.timeRange) {
      const { tableSlug } = parseFieldRef(input.timeRange.field);
      if (tableSlug) referencedTableSlugs.add(tableSlug);
    }

    referencedTableSlugs.delete(rootSource.dataset.slug);

    // Resolve multi-table relationships if other tables are referenced
    const joins: ResolvedJoin[] = [];
    const tableContexts: TableContext[] = [
      { slug: rootSource.dataset.slug, alias: 'source', fields: rootMapping.fields }
    ];

    if (referencedTableSlugs.size > 0) {
      const relRows = (await client.query<{
        id: string; from_dataset_id: string; from_slug: string; from_field: string;
        to_dataset_id: string; to_slug: string; to_field: string;
        cardinality: any; join_type: any; is_preferred: boolean;
      }>(
        `SELECT r.id, r.from_dataset_id, d1.slug AS from_slug, r.from_field,
                r.to_dataset_id, d2.slug AS to_slug, r.to_field,
                r.cardinality, r.join_type, r.is_preferred
         FROM semantic_relationships r
         JOIN datasets d1 ON d1.id = r.from_dataset_id
         JOIN datasets d2 ON d2.id = r.to_dataset_id`
      )).rows;

      const relationships: RelationshipRecord[] = relRows.map(r => ({
        id: r.id,
        fromDatasetId: r.from_dataset_id,
        fromDatasetSlug: r.from_slug,
        fromField: r.from_field,
        toDatasetId: r.to_dataset_id,
        toDatasetSlug: r.to_slug,
        toField: r.to_field,
        cardinality: r.cardinality,
        joinType: r.join_type,
        isPreferred: r.is_preferred,
      }));

      // Find published datasets for referenced slugs
      const slugsArray = Array.from(referencedTableSlugs);
      const datasetRows = (await client.query<{ id: string; slug: string; current_version_id: string | null }>(
        'SELECT id, slug, current_version_id FROM datasets WHERE slug = ANY($1)',
        [slugsArray]
      )).rows;

      const availableNodes = new Map<string, DatasetNode>();
      availableNodes.set(rootSource.dataset.id, {
        id: rootSource.dataset.id,
        slug: rootSource.dataset.slug,
        versionId: rootSource.version.id,
      });

      const requiredDatasetIds: string[] = [];
      for (const ds of datasetRows) {
        if (!ds.current_version_id) {
          throw new DomainError('VERSION_NOT_READY', 400, `El dataset '${ds.slug}' no tiene una versión publicada vigente.`);
        }
        availableNodes.set(ds.id, { id: ds.id, slug: ds.slug, versionId: ds.current_version_id });
        requiredDatasetIds.push(ds.id);

        const dsSource = await this.ingestion.source(client, ds.current_version_id);
        tableContexts.push({
          slug: ds.slug,
          alias: '', // Will be assigned by resolved join
          fields: dsSource.version.mapping!.fields,
        });
      }

      const rootNode: DatasetNode = {
        id: rootSource.dataset.id,
        slug: rootSource.dataset.slug,
        versionId: rootSource.version.id,
      };

      const resolved = resolveJoinPaths(rootNode, requiredDatasetIds, availableNodes, relationships);
      for (const rj of resolved) {
        joins.push(rj);
        const ctx = tableContexts.find(t => t.slug === rj.tableSlug);
        if (ctx) ctx.alias = rj.alias;
      }
    }

    const parameters: unknown[] = [...rootSource.parameters];
    const bind = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };

    // Compile formula with resolved tables
    const compiled = compileFormula(ast, tableContexts, rootSource.dataset.slug, parameters);

    // Resolve field reference across available tables
    const resolveField = (rawName: string, isFilterOrTimeRange = false): { alias: string; field: SourceField } | null => {
      const { tableSlug, fieldTarget } = parseFieldRef(rawName);
      let targetTable: TableContext | undefined;
      if (tableSlug) {
        targetTable = tableContexts.find(t => t.slug === tableSlug);
        if (!targetTable) {
          if (isFilterOrTimeRange) return null;
          throw new DomainError('INVALID_DIMENSION', 400, `Dataset '${tableSlug}' no disponible.`);
        }
      } else {
        targetTable = tableContexts.find(t => t.fields.some(f => f.target === fieldTarget));
        if (!targetTable) targetTable = tableContexts[0]!;
      }
      const found = targetTable.fields.find(f => f.target === fieldTarget);
      if (!found) {
        if (isFilterOrTimeRange) return null;
        throw new DomainError('INVALID_DIMENSION', 400, `El campo '${rawName}' no existe en los datasets vinculados.`);
      }

      // If it is a GROUP BY dimension: must be permitted in kpi.dimensions
      if (!isFilterOrTimeRange) {
        const isPermitted = kpi.dimensions.includes(rawName) || kpi.dimensions.includes(fieldTarget);
        if (!isPermitted) {
          throw new DomainError('INVALID_DIMENSION', 400, `La dimensión '${rawName}' no está permitida para este KPI.`);
        }
      }
      return { alias: targetTable.alias || 'source', field: found };
    };

    if (new Set(input.dimensions).size !== input.dimensions.length) {
      throw new DomainError('INVALID_DIMENSION', 400, 'Las dimensiones deben ser únicas.');
    }

    const wfCols: Record<string, string> = (kpi.workforceMapping?.enabled && kpi.workforceMapping?.datasetField)
      ? {
          supervisor: "COALESCE(wf_sup.name, 'Sin supervisor')",
          'workforce.supervisor': "COALESCE(wf_sup.name, 'Sin supervisor')",
          floor_manager: "COALESCE(wf_fm.name, 'Sin FM')",
          fm: "COALESCE(wf_fm.name, 'Sin FM')",
          'workforce.floor_manager': "COALESCE(wf_fm.name, 'Sin FM')",
          'workforce.fm': "COALESCE(wf_fm.name, 'Sin FM')",
          wave: "COALESCE(wf_emp.wave, 'Sin ola')",
          'workforce.wave': "COALESCE(wf_emp.wave, 'Sin ola')",
          tenure: "COALESCE(wf_emp.hire_date::text, 'Sin fecha')",
          'workforce.tenure': "COALESCE(wf_emp.hire_date::text, 'Sin fecha')",
          agent_name: "CONCAT(wf_emp.first_name, ' ', wf_emp.last_name)",
          'workforce.agent_name': "CONCAT(wf_emp.first_name, ' ', wf_emp.last_name)",
          agent_code: "wf_emp.code",
          'workforce.agent_code': "wf_emp.code",
          bms_id: "COALESCE(wf_emp.bms_id, 'Sin BMS ID')",
          'workforce.bms_id': "COALESCE(wf_emp.bms_id, 'Sin BMS ID')",
          team: "COALESCE(wf_team.name, 'Sin equipo')",
          'workforce.team': "COALESCE(wf_team.name, 'Sin equipo')",
          week: "COALESCE(wf_week.week_code, 'Sin semana')",
          'workforce.week': "COALESCE(wf_week.week_code, 'Sin semana')",
        }
      : {};

    let wfJoinSql = '';
    if (Object.keys(wfCols).length > 0) {
      const matchKey = kpi.workforceMapping!.matchKey || 'code';
      const dsFieldParam = bind(kpi.workforceMapping!.datasetField);
      let matchClause = '';
      if (matchKey === 'bms_id') {
        matchClause = `LOWER(TRIM(wf_emp.bms_id)) = LOWER(TRIM(source.values ->> ${dsFieldParam}::text))`;
      } else if (matchKey === 'normalized_name') {
        matchClause = `wf_emp.normalized_name = UPPER(TRIM(regexp_replace(source.values ->> ${dsFieldParam}::text, '\\s+', ' ', 'g')))`;
      } else {
        matchClause = `LOWER(TRIM(wf_emp.code)) = LOWER(TRIM(source.values ->> ${dsFieldParam}::text))`;
      }

      wfJoinSql = `
        LEFT JOIN employees AS wf_emp ON ${matchClause}
        LEFT JOIN LATERAL (
          SELECT m.id, CONCAT(m.first_name, ' ', m.last_name) AS name, m.code
          FROM employee_relationships r
          JOIN employees m ON m.id = r.manager_id
          WHERE r.employee_id = wf_emp.id AND r.relation_type = 'supervisor' AND (r.valid_to IS NULL OR r.valid_to > now())
          ORDER BY r.valid_from DESC LIMIT 1
        ) wf_sup ON true
        LEFT JOIN LATERAL (
          SELECT m.id, CONCAT(m.first_name, ' ', m.last_name) AS name, m.code
          FROM employee_relationships r
          JOIN employees m ON m.id = r.manager_id
          WHERE r.employee_id = wf_emp.id AND r.relation_type = 'floor_manager' AND (r.valid_to IS NULL OR r.valid_to > now())
          ORDER BY r.valid_from DESC LIMIT 1
        ) wf_fm ON true
        LEFT JOIN LATERAL (
          SELECT t.id, t.name, t.slug, a.metadata, a.week_id
          FROM employment_assignments a
          LEFT JOIN teams t ON t.id = a.team_id
          WHERE a.employee_id = wf_emp.id AND (a.valid_to IS NULL OR a.valid_to > now())
          ORDER BY a.valid_from DESC LIMIT 1
        ) wf_team ON true
        LEFT JOIN workforce_weeks AS wf_week ON wf_week.id = wf_team.week_id
      `;
    }

    const dimensions = input.dimensions.map(name => {
      const lower = name.toLowerCase();
      if (wfCols[name] || wfCols[lower]) {
        const isPermitted = kpi.dimensions.includes(name) ||
          kpi.dimensions.includes(lower) ||
          (kpi.workforceMapping?.selectedColumns || []).includes(name) ||
          (kpi.workforceMapping?.selectedColumns || []).includes(lower) ||
          ['supervisor', 'floor_manager', 'fm', 'wave', 'tenure', 'team', 'bms_id', 'agent_name', 'agent_code', 'week'].includes(lower.replace('workforce.', ''));
        if (!isPermitted) {
          throw new DomainError('INVALID_DIMENSION', 400, `La dimensión '${name}' no está permitida para este KPI.`);
        }
        return `(${wfCols[name] || wfCols[lower]})::text`;
      }
      const resolved = resolveField(name, false);
      if (!resolved) throw new DomainError('INVALID_DIMENSION', 400, `La dimensión '${name}' no está disponible.`);
      return `(${resolved.alias}.values ->> ${bind(resolved.field.target)}::text)`;
    });

    const casts = {
      string: 'text', integer: 'numeric', decimal: 'numeric',
      duration: 'numeric', boolean: 'boolean', date: 'date', datetime: 'timestamptz'
    } as const;
    const ops = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

    const filters: string[] = [];
    for (const filter of input.filters) {
      const norm = filter.field.toLowerCase();
      if (wfCols[norm] || wfCols[filter.field]) {
        const sqlCol = wfCols[norm] || wfCols[filter.field]!;
        filters.push(`(${sqlCol})::text ${ops[filter.op]} ${bind(String(filter.value))}::text`);
        continue;
      }

      let resolved = resolveField(filter.field, true);
      if (!resolved) {
        for (const tc of tableContexts) {
          const match = tc.fields.find(f => {
            const t = f.target.toLowerCase();
            if (t === norm) return true;
            if (norm === 'supervisor' && (t === 'sup' || t === 'team_leader' || t === 'tl' || t === 'supervisor_name')) return true;
            if (norm === 'fm' && (t === 'floor_manager' || t === 'jefe_piso' || t === 'floor_mgr')) return true;
            if (norm === 'floor_manager' && (t === 'fm' || t === 'jefe_piso')) return true;
            if (norm === 'wave' && (t === 'ola' || t === 'cohorte' || t === 'grupo_wave')) return true;
            return false;
          });
          if (match) {
            resolved = { alias: tc.alias || 'source', field: match };
            break;
          }
        }
      }

      if (!resolved) continue;

      const { alias, field } = resolved;
      let value;
      try {
        value = normalize(filter.value, field.type, {
          ...rootMapping.regional,
          decimalSeparator: '.',
          thousandsSeparator: 'none',
          dateFormat: 'YYYY-MM-DD'
        }, true);
      } catch {
        throw new DomainError('INVALID_FILTER', 400, `El filtro '${filter.field}' no coincide con el tipo de campo (${field.type}).`);
      }
      filters.push(`(${alias}.values ->> ${bind(field.target)}::text)::${casts[field.type]} ${ops[filter.op]} ${bind(value)}::${casts[field.type]}`);
    }

    if (input.timeRange && (input.timeRange.from || input.timeRange.to)) {
      let timeFieldRef: { alias: string; field: SourceField } | null = null;
      if (input.timeRange.field && input.timeRange.field.trim()) {
        timeFieldRef = resolveField(input.timeRange.field.trim(), true);
      }

      if (!timeFieldRef) {
        for (const tc of tableContexts) {
          const dateField = tc.fields.find(f => f.type === 'date' || f.type === 'datetime');
          if (dateField) {
            timeFieldRef = { alias: tc.alias || 'source', field: dateField };
            break;
          }
        }
      }

      if (!timeFieldRef) {
        for (const tc of tableContexts) {
          const dateField = tc.fields.find(f => /fecha|date|timestamp|time|dia|periodo|created_at/i.test(f.target));
          if (dateField) {
            timeFieldRef = { alias: tc.alias || 'source', field: dateField };
            break;
          }
        }
      }

      if (timeFieldRef) {
        const { alias, field } = timeFieldRef;
        if (input.timeRange.from) {
          filters.push(`(${alias}.values ->> ${bind(field.target)}::text)::${casts[field.type]} >= ${bind(input.timeRange.from)}::${casts[field.type]}`);
        }
        if (input.timeRange.to) {
          filters.push(`(${alias}.values ->> ${bind(field.target)}::text)::${casts[field.type]} <= ${bind(input.timeRange.to)}::${casts[field.type]}`);
        }
      }
    }

    // Build JOIN clauses
    let joinSql = '';
    for (const j of joins) {
      const verParam = bind(j.versionId);
      const toFieldParam = bind(j.toField);
      const fromFieldParam = bind(j.fromField);
      const joinKeyword = j.joinType === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
      joinSql += ` ${joinKeyword} dataset_rows AS ${j.alias} ON ${j.alias}.version_id = ${verParam}::uuid AND (${j.alias}.values ->> ${toFieldParam}::text) = (${j.fromAlias}.values ->> ${fromFieldParam}::text)`;
    }

    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL work_mem = '16MB'");
    await client.query("SET LOCAL timezone = 'UTC'");

    const sql = `SELECT ${dimensions.map((s, i) => `${s} AS d${i}`).join(',')}${dimensions.length ? ',' : ''} ROUND((${compiled.sql})::numeric, ${bind(kpi.precision)}::int)::text AS value FROM ${rootSource.relation} AS source${joinSql}${wfJoinSql} ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ${dimensions.length ? `GROUP BY ${dimensions.map((_, i) => i + 1).join(',')} ORDER BY ${dimensions.map((_, i) => `${i + 1} NULLS LAST`).join(',')}` : ''} LIMIT ${bind(input.limit + 1)}::int`;

    const rows = (await client.query<Record<string, string | null>>(sql, parameters)).rows;
    const targetEval = evaluateTarget(rows[0]?.value ?? null, kpi.targetDirection, kpi.targets);

    const joinPath = joins.map(j => j.pathDescription);
    if (wfJoinSql) {
      joinPath.push(`Workforce (${kpi.workforceMapping?.matchKey || 'code'} ➔ ${kpi.workforceMapping?.datasetField})`);
    }

    return queryResultSchema.parse({
      kpiVersionId: kpi.id,
      modelVersionId: kpi.modelVersionId,
      datasetVersionId: kpi.datasetVersionId,
      sourceHash: rootSource.version.sha256,
      rows: rows.slice(0, input.limit).map(row => ({
        dimensions: Object.fromEntries(input.dimensions.map((name, i) => [name, row[`d${i}`] ?? null])),
        value: row.value ?? null,
      })),
      truncated: rows.length > input.limit,
      warnings: compiled.hasDivision ? ['La división entre cero devuelve nulo.'] : [],
      queryHash: createHash('sha256').update(JSON.stringify({ tenant: rootSource.dataset.id, ...input, model: kpi.modelVersionId })).digest('hex'),
      joinPath,
      cacheHit: false,
      targetEvaluation: targetEval,
    });
  }
}
