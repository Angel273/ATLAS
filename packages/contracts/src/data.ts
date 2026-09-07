/**
 * @file packages/contracts/src/data.ts
 * @description Esquemas y tipos Zod para el ciclo de vida de ingesta y datasets en ATLAS.
 * Cubre límites de carga (MAX_UPLOAD_BYTES), tipos de campos soportados, configuraciones regionales
 * (separadores decimales, formato de fecha, zona horaria), políticas de manejo de errores,
 * esquemas de mapeo de origen a destino, versionado inmutable de datasets, perfilado streaming,
 * reportes de incidencias/validación y la clase base de error de dominio (DomainError).
 */

import { z } from 'zod';
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const fieldTypeSchema = z.enum(['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'duration']);
export type FieldType = z.infer<typeof fieldTypeSchema>;
export type SourceField = z.infer<typeof sourceFieldSchema>;
export const sourceFieldSchema = z.object({ source: z.string().min(1).max(200), target: z.string().regex(/^[a-z][a-z0-9_]*$/).max(63), type: fieldTypeSchema, required: z.boolean() }).strict();
export const regionalSchema = z.object({
  decimalSeparator: z.enum(['.', ',']), thousandsSeparator: z.enum(['.', ',', ' ', 'none']),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']), timezone: z.string().min(1).max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  delimiter: z.enum([',', ';', '\t']),
}).strict().refine(value => value.decimalSeparator !== value.thousandsSeparator, 'Los separadores decimal y de miles deben ser diferentes.');
export type Regional = z.infer<typeof regionalSchema>;
export const errorPolicySchema = z.enum(['strict', 'nullify', 'skip']);
export type ErrorPolicy = z.infer<typeof errorPolicySchema>;
export const mappingSchema = z.object({
  sheet: z.string().min(1).max(200),
  fields: z.array(sourceFieldSchema).min(1).max(200),
  keyFields: z.array(z.string()).max(10),
  strategy: z.enum(['replace', 'append', 'upsert']),
  errorPolicy: errorPolicySchema.default('strict'),
  regional: regionalSchema,
}).strict().superRefine((value, ctx) => {
  const targets = value.fields.map(field => field.target), sources = value.fields.map(field => field.source);
  if (new Set(targets).size !== targets.length || new Set(sources).size !== sources.length) ctx.addIssue({ code: 'custom', message: 'Cada columna y destino debe aparecer una sola vez.' });
  if (new Set(value.keyFields).size !== value.keyFields.length || value.keyFields.some(key => !targets.includes(key)) || (value.strategy === 'upsert' && !value.keyFields.length)) ctx.addIssue({ code: 'custom', message: 'Selecciona claves únicas del mapeo.' });
});
export type Mapping = z.infer<typeof mappingSchema>;
export const datasetCreateSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/) }).strict();
export const uploadCreateSchema = z.object({ filename: z.string().min(1).max(200).refine(value => !/[\r\n\0/\\]/.test(value)), bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES), format: z.enum(['csv', 'xlsx']), regional: regionalSchema }).strict().refine(value => value.filename.toLowerCase().endsWith(`.${value.format}`), 'La extensión no coincide con el formato.');
export const datasetSchema = z.object({ id: z.uuid(), name: z.string(), slug: z.string(), currentVersionId: z.uuid().nullable(), archivedAt: z.string().nullable().default(null), createdAt: z.string() }).strict();
export const datasetListSchema = z.object({ items: z.array(datasetSchema) }).strict();
export const datasetLifecycleResultSchema = z.object({ action: z.enum(['deleted', 'archived', 'unarchived']), id: z.uuid() }).strict();
export const profileSchema = z.object({ sheets: z.array(z.object({ name: z.string(), headers: z.array(z.string()), sample: z.array(z.array(z.string().nullable())).max(5), rows: z.number().int(), suggested: z.array(sourceFieldSchema) }).strict()).max(30) }).strict();
export const issueSchema = z.object({ row: z.number().int(), field: z.string(), code: z.string() }).strict();
export const issueReportSchema = z.object({ items: z.array(issueSchema).max(11000), complete: z.boolean() }).strict();
export const versionSchema = z.object({ id: z.uuid(), datasetId: z.uuid(), number: z.number().int(), filename: z.string(), bytes: z.number().int(), regional: regionalSchema, state: z.enum(['uploaded', 'profiling', 'awaiting_mapping', 'validating', 'importing', 'ready', 'failed', 'cancelled']), sha256: z.string().nullable(), profile: profileSchema.nullable(), mapping: mappingSchema.nullable(), rows: z.number().int(), issues: z.array(issueSchema), issueCount: z.number().int(), errorCode: z.string().nullable(), publishedAt: z.string().nullable(), createdAt: z.string(), progress: z.number().int().min(0).max(100) }).strict();
export type DatasetVersion = z.infer<typeof versionSchema>;
export const versionListSchema = z.object({ items: z.array(versionSchema) }).strict();
export const uploadResultSchema = z.object({ version: versionSchema, uploadUrl: z.url() }).strict();
export const dataPreviewSchema = z.object({ fields: z.array(sourceFieldSchema), rows: z.array(z.record(z.string(), z.union([z.string(), z.boolean(), z.null()]))) }).strict();
export const actionResultSchema = z.object({ ok: z.literal(true) }).strict();
export const actorSchema = z.object({ userId: z.uuid(), tenantId: z.uuid(), capabilities: z.array(z.string()) });
export type DataActor = z.infer<typeof actorSchema>;

/**
 * Error de dominio operacional con código semántico y status HTTP asociado.
 */
export class DomainError extends Error {
  /**
   * @param code Código de error tipado de dominio.
   * @param status Código de estado HTTP correspondiente (ej. 400, 403, 404, 409).
   * @param message Mensaje legible para el usuario o log auditado.
   */
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message); }
}
