import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createPool, withTenant, type PoolClient } from '@atlas/database';
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

const select = `SELECT id, name, slug, description, number, model_version_id AS "modelVersionId", dataset_version_id AS "datasetVersionId", formula, unit, precision, dimensions, target_direction AS "targetDirection", targets, dependencies, deprecated_at::text AS "deprecatedAt", published_at::text AS "publishedAt", created_at::text AS "createdAt" FROM kpi_versions`;
const relSelect = `SELECT id, from_dataset_id AS "fromDatasetId", from_field AS "fromField", to_dataset_id AS "toDatasetId", to_field AS "toField", cardinality, join_type AS "joinType", is_preferred AS "isPreferred", published_at::text AS "publishedAt", created_at::text AS "createdAt" FROM semantic_relationships`;

export class KpiService {
  readonly pool = createPool(process.env.DATABASE_URL);
  private readonly queryCache = new Map<string, { result: z.infer<typeof queryResultSchema>; expiresAt: number }>();

  constructor(private readonly ingestion: IngestionService) {}

  async onModuleDestroy() {
    this.queryCache.clear();
    await this.pool.end();
  }

  // --- Semantic Relationships ---

  async listRelationships(actor: DataActor) {
    permit(actor, 'semantic.read');
    return withTenant(this.pool, actor.tenantId, async client => {
      const rows = (await client.query(`${relSelect} ORDER BY created_at DESC LIMIT 100`)).rows;
      return semanticRelationshipListSchema.parse({ items: rows });
    });
  }

  async createRelationship(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'semantic.manage');
    const input = semanticRelationshipCreateSchema.parse(body);
    z.uuid().parse(key);

    return withTenant(this.pool, actor.tenantId, async client => {
      const previous = (await client.query(`${relSelect} WHERE creation_key = $1`, [key])).rows[0];
      if (previous) return semanticRelationshipSchema.parse(previous);

      if (input.fromDatasetId === input.toDatasetId) {
        throw new DomainError('INVALID_RELATIONSHIP', 400, 'Una relación debe conectar dos datasets distintos.');
      }

      const fromDs = (await client.query<{ id: string; current_version_id: string | null }>(
        'SELECT id, current_version_id FROM datasets WHERE id = $1',
        [input.fromDatasetId]
      )).rows[0];
      const toDs = (await client.query<{ id: string; current_version_id: string | null }>(
        'SELECT id, current_version_id FROM datasets WHERE id = $1',
        [input.toDatasetId]
      )).rows[0];

      if (!fromDs || !toDs) {
        throw new DomainError('DATASET_NOT_FOUND', 404, 'Dataset de origen o destino no encontrado.');
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
          tenant_id, from_dataset_id, from_field, to_dataset_id, to_field,
          cardinality, join_type, is_preferred, creation_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          actor.tenantId, input.fromDatasetId, input.fromField,
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

  async list(actor: DataActor, includeDeprecated = false) {
    permit(actor, 'semantic.read');
    return withTenant(this.pool, actor.tenantId, async client => {
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

  private async get(client: PoolClient, id: string) {
    const row = (await client.query(`${select} WHERE id = $1`, [z.uuid().parse(id)])).rows[0];
    if (!row) throw new DomainError('KPI_NOT_FOUND', 404, 'KPI no encontrado.');
    return kpiSchema.parse(row);
  }

  async create(actor: DataActor, body: unknown, key: string, correlation: string) {
    permit(actor, 'semantic.manage');
    const input = kpiCreateSchema.parse(body);
    z.uuid().parse(key);

    return withTenant(this.pool, actor.tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${actor.tenantId}:${input.slug}`]);
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
        'INSERT INTO semantic_model_versions(tenant_id, dataset_version_id, fields) VALUES ($1, $2, $3) ON CONFLICT(tenant_id, dataset_version_id) DO NOTHING',
        [actor.tenantId, input.datasetVersionId, JSON.stringify(source.version.mapping!.fields)]
      );
      const model = (await client.query<{ id: string }>(
        'SELECT id FROM semantic_model_versions WHERE dataset_version_id = $1',
        [input.datasetVersionId]
      )).rows[0]!;

      const result = await client.query<{ id: string }>(
        `INSERT INTO kpi_versions(
          tenant_id, slug, number, name, description, model_version_id, dataset_version_id,
          formula, ast, unit, precision, dimensions, target_direction, targets, dependencies,
          actor_id, creation_key
        ) VALUES (
          $1, $2::varchar, (SELECT COALESCE(MAX(number), 0) + 1 FROM kpi_versions WHERE slug = $2::varchar),
          $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        ) RETURNING id`,
        [
          actor.tenantId, input.slug, input.name, input.description, model.id, input.datasetVersionId,
          input.formula, ast, input.unit, input.precision, JSON.stringify(input.dimensions),
          input.targetDirection, JSON.stringify(input.targets), JSON.stringify(input.dependencies),
          actor.userId, key
        ]
      );

      const id = result.rows[0]!.id;
      await audit(client, actor, 'kpi.created', id, correlation);
      return this.get(client, id);
    });
  }

  async publish(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.publish');
    return withTenant(this.pool, actor.tenantId, async client => {
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

  async deprecate(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.publish');
    return withTenant(this.pool, actor.tenantId, async client => {
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

  async deleteOrDeprecate(actor: DataActor, id: string, correlation: string) {
    permit(actor, 'semantic.manage');
    return withTenant(this.pool, actor.tenantId, async client => {
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

  async query(actor: DataActor, body: unknown, correlation: string) {
    permit(actor, 'semantic.read');
    const input = querySchema.parse(body);

    const cacheKey = `${actor.tenantId}:${input.kpiVersionId}:${JSON.stringify(input)}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.result, cacheHit: true };
    }

    try {
      return await withTenant(this.pool, actor.tenantId, async client => {
        const kpi = await this.get(client, input.kpiVersionId);
        if (!kpi.publishedAt && !actor.capabilities.includes('semantic.manage')) {
          throw new DomainError('KPI_NOT_FOUND', 404, 'KPI no encontrado.');
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

    const dimensions = input.dimensions.map(name => {
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
      let resolved = resolveField(filter.field, true);
      if (!resolved) {
        const norm = filter.field.toLowerCase();
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

    const sql = `SELECT ${dimensions.map((s, i) => `${s} AS d${i}`).join(',')}${dimensions.length ? ',' : ''} ROUND((${compiled.sql})::numeric, ${bind(kpi.precision)}::int)::text AS value FROM ${rootSource.relation} AS source${joinSql} ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ${dimensions.length ? `GROUP BY ${dimensions.map((_, i) => i + 1).join(',')} ORDER BY ${dimensions.map((_, i) => `${i + 1} NULLS LAST`).join(',')}` : ''} LIMIT ${bind(input.limit + 1)}::int`;

    const rows = (await client.query<Record<string, string | null>>(sql, parameters)).rows;
    const targetEval = evaluateTarget(rows[0]?.value ?? null, kpi.targetDirection, kpi.targets);

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
      joinPath: joins.map(j => j.pathDescription),
      cacheHit: false,
      targetEvaluation: targetEval,
    });
  }
}
