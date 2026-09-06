import { z } from 'zod';

export const cardinalitySchema = z.enum(['one_to_one', 'many_to_one', 'one_to_many']);
export type Cardinality = z.infer<typeof cardinalitySchema>;

export const joinTypeSchema = z.enum(['inner', 'left']);
export type JoinType = z.infer<typeof joinTypeSchema>;

export const semanticRelationshipCreateSchema = z.object({
  fromDatasetId: z.uuid(),
  fromField: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  toDatasetId: z.uuid(),
  toField: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  cardinality: cardinalitySchema,
  joinType: joinTypeSchema.default('left'),
  isPreferred: z.boolean().default(false),
}).strict();

export const semanticRelationshipSchema = semanticRelationshipCreateSchema.extend({
  id: z.uuid(),
  publishedAt: z.string(),
  createdAt: z.string(),
}).strict();

export const semanticRelationshipListSchema = z.object({
  items: z.array(semanticRelationshipSchema),
}).strict();

export type SemanticRelationship = z.infer<typeof semanticRelationshipSchema>;

export const targetDirectionSchema = z.enum(['higher_is_better', 'lower_is_better', 'target_match']);
export type TargetDirection = z.infer<typeof targetDirectionSchema>;

export const kpiTargetsSchema = z.object({
  target: z.number().optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
}).strict();
export type KpiTargets = z.infer<typeof kpiTargetsSchema>;

export const kpiCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  description: z.string().max(1000),
  datasetVersionId: z.uuid(),
  relatedDatasetVersionIds: z.array(z.uuid()).max(5).default([]),
  formula: z.string().min(1).max(4000),
  unit: z.enum(['number','percent','seconds']),
  precision: z.number().int().min(0).max(12),
  dimensions: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}(?:\.[a-z][a-z0-9_]{0,62})?$/)).max(10),
  targetDirection: targetDirectionSchema.default('higher_is_better'),
  targets: kpiTargetsSchema.default({}),
  dependencies: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)).max(10).default([]),
}).strict();

export const kpiSchema = kpiCreateSchema.extend({
  id: z.uuid(),
  number: z.number().int(),
  modelVersionId: z.uuid(),
  publishedAt: z.string().nullable(),
  deprecatedAt: z.string().nullable().default(null),
  createdAt: z.string(),
}).strict();

export const kpiListSchema = z.object({ items: z.array(kpiSchema) }).strict();
export const kpiLifecycleResultSchema = z.object({ action: z.enum(['deleted', 'deprecated']), id: z.uuid() }).strict();
export type Kpi = z.infer<typeof kpiSchema>;

export const querySchema = z.object({
  kpiVersionId: z.uuid(),
  dimensions: z.array(z.string().max(63)).max(3).default([]),
  filters: z.array(z.object({
    field: z.string().max(63),
    op: z.enum(['eq','ne','gt','gte','lt','lte']),
    value: z.union([z.string().max(500),z.boolean()])
  }).strict()).max(10).default([]),
  timeRange: z.object({
    field: z.string().max(63).optional().default(''),
    from: z.string().max(50).optional(),
    to: z.string().max(50).optional(),
  }).strict().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
}).strict();

export const queryResultSchema = z.object({
  kpiVersionId: z.uuid(),
  modelVersionId: z.uuid(),
  datasetVersionId: z.uuid(),
  sourceHash: z.string(),
  rows: z.array(z.object({
    dimensions: z.record(z.string(), z.string().nullable()),
    value: z.string().nullable()
  }).strict()),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
  queryHash: z.string(),
  joinPath: z.array(z.string()).default([]),
  cacheHit: z.boolean().default(false),
  targetEvaluation: z.object({
    status: z.enum(['good', 'warning', 'critical', 'neutral']),
    target: z.number().nullable(),
  }).optional(),
}).strict();

