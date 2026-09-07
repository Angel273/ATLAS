/**
 * @file packages/contracts/src/index.ts
 * @description Punto de entrada principal y exportación unificada del paquete de contratos (@atlas/contracts).
 * Define los esquemas Zod y tipos TypeScript para la gestión de identidad, roles del sistema,
 * capacidades (RBAC), sesiones, perfiles de usuario, administración multi-tenant, cuentas operacionales,
 * respuestas de error estructuradas y flags de características. Re-exporta además los contratos de datos,
 * KPIs, dashboards, workforce y modelos de inteligencia artificial.
 */

import { z } from 'zod';
export * from './data.js';
export * from './kpi.js';
export * from './dashboard.js';
export * from './workforce.js';
export * from './ai.js';


export const roleSchema = z.enum(['admin', 'supervisor', 'floor_manager', 'quality_coordinator', 'operations_manager', 'ceo']);
export type Role = z.infer<typeof roleSchema>;

export const capabilitySchema = z.enum([
  'tenant.manage', 'user.manage', 'dataset.read', 'dataset.manage',
  'semantic.read', 'semantic.manage', 'semantic.publish', 'dashboard.read',
  'dashboard.manage', 'dashboard.publish', 'workforce.read', 'workforce.manage',
  'ai.use', 'audit.read',
]);
export type Capability = z.infer<typeof capabilitySchema>;
const analytical: readonly Capability[] = ['dashboard.read', 'semantic.read', 'ai.use'];
const operational: readonly Capability[] = [...analytical, 'dataset.read', 'workforce.read'];
export const roleCapabilities: Readonly<Record<Role, readonly Capability[]>> = {
  admin: capabilitySchema.options,
  supervisor: operational, floor_manager: operational, quality_coordinator: operational,
  operations_manager: [...analytical, 'workforce.read'], ceo: analytical,
};
export const roleLabels: Readonly<Record<Role, string>> = {
  admin: 'Administrador', supervisor: 'Supervisor', floor_manager: 'Jefe de piso',
  quality_coordinator: 'Coordinador de calidad', operations_manager: 'Operations Manager', ceo: 'CEO',
};
export const updateRoleSchema = z.object({ role: roleSchema }).strict();
export const updateRoleResultSchema = z.object({ updated: z.literal(true) }).strict();
export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  name: z.string().default(''),
  role: roleSchema,
  mfaEnabled: z.boolean().default(false),
  disabled: z.boolean().default(false),
}).strict();
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ items: z.array(memberSchema) }).strict();

export const adminUserDetailSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  mfaEnabled: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
}).strict();
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;

export const adminUpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(254).transform(value => value.trim().toLowerCase()).optional(),
  role: roleSchema.optional(),
  password: z.string().min(14).max(128).optional(),
  resetMfa: z.boolean().optional(),
  disabled: z.boolean().optional(),
}).strict().refine(data =>
  data.name !== undefined ||
  data.email !== undefined ||
  data.role !== undefined ||
  data.password !== undefined ||
  data.resetMfa !== undefined ||
  data.disabled !== undefined,
  { message: 'Debes proporcionar al menos un campo para actualizar.' }
);
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const adminUpdateUserResultSchema = z.object({
  updated: z.literal(true),
  user: adminUserDetailSchema,
}).strict();
export type AdminUpdateUserResult = z.infer<typeof adminUpdateUserResultSchema>;

export const createUserSchema = z.object({
  email: z.string().email().max(254).transform(value => value.trim().toLowerCase()),
  name: z.string().trim().max(120).default(''),
  role: roleSchema,
  password: z.string().min(14).max(128),
}).strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const createUserResultSchema = z.object({
  id: z.uuid(), userId: z.uuid(), email: z.string(), name: z.string(), role: roleSchema,
}).strict();
export type CreateUserResult = z.infer<typeof createUserResultSchema>;

export const removeMemberResultSchema = z.object({ removed: z.literal(true) }).strict();

export const userProfileSchema = z.object({
  id: z.uuid(), email: z.string(), name: z.string(), role: roleSchema, roleLabel: z.string(),
  capabilities: z.array(capabilitySchema), organization: z.string(), mfaEnabled: z.boolean(), createdAt: z.string(),
}).strict();
export type UserProfile = z.infer<typeof userProfileSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().email().max(254).transform(value => value.trim().toLowerCase()).optional(),
}).strict().refine(data => data.name !== undefined || data.email !== undefined, {
  message: 'Debes proporcionar al menos un campo para actualizar.',
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(14).max(128),
}).strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changePasswordResultSchema = z.object({ updated: z.literal(true) }).strict();

export const errorResponseSchema = z.object({
  code: z.string().min(1), message: z.string().min(1), correlationId: z.uuid(),
}).strict();

export const featureFlagsSchema = z.object({
  authentication: z.boolean(), ingestion: z.boolean(), semanticModel: z.boolean(),
  dashboards: z.boolean(), workforce: z.boolean(), aiChat: z.boolean(),
}).strict();
export const foundationFeatures = featureFlagsSchema.parse({
  authentication: false, ingestion: false, semanticModel: false,
  dashboards: false, workforce: false, aiChat: false,
});

export const healthSchema = z.object({
  service: z.literal('atlas-api'), status: z.literal('ok'),
  version: z.string(), timestamp: z.iso.datetime(),
}).strict();

export const accountSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(120), timezone: z.string(),
}).strict();
export const accountListSchema = z.object({ items: z.array(accountSchema) }).strict();
export const createAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('es', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'Selecciona una zona horaria válida.'),
}).strict();

export const updateAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('es', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'Selecciona una zona horaria válida.').optional(),
}).strict().refine(data => data.name !== undefined || data.timezone !== undefined, {
  message: 'Debes proporcionar al menos un campo para actualizar.',
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const deleteAccountResultSchema = z.object({ deleted: z.literal(true) }).strict();

export const loginSchema = z.object({ email: z.email().max(254).transform(value => value.trim().toLowerCase()), password: z.string().min(1).max(128) }).strict();
export const totpSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const sessionSchema = z.object({
  userId: z.uuid(), tenantId: z.uuid(), role: roleSchema,
  capabilities: z.array(capabilitySchema), organization: z.string(),
  name: z.string().default(''), email: z.string().default(''),
}).strict();
export type Session = z.infer<typeof sessionSchema>;
export const loginResultSchema = z.object({ stage: z.enum(['mfa_setup', 'mfa_verify', 'authenticated']) }).strict();
export const mfaSetupSchema = z.object({ secret: z.string(), uri: z.string() }).strict();

export const importStateSchema = z.enum(['uploaded', 'profiling', 'awaiting_mapping', 'validating', 'importing', 'ready', 'failed', 'cancelled', 'archived']);
export type ImportState = z.infer<typeof importStateSchema>;

export const datasetMappingSchema = z.object({
  strategy: z.enum(['replace', 'append', 'upsert']),
  fields: z.array(z.object({
    source: z.string().min(1).max(200), target: z.string().regex(/^[a-z][a-z0-9_]*$/).max(63),
    type: z.enum(['string', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'duration']),
    required: z.boolean(),
  }).strict()).min(1).max(200),
  keyFields: z.array(z.string().min(1)).max(10),
}).strict().superRefine((value, ctx) => {
  const targets = value.fields.map(field => field.target);
  if (new Set(targets).size !== targets.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Los nombres de destino deben ser únicos.' });
  if (new Set(value.keyFields).size !== value.keyFields.length || value.keyFields.some(key => !targets.includes(key))) ctx.addIssue({ code: 'custom', path: ['keyFields'], message: 'Las claves deben ser campos únicos del mapeo.' });
  if (value.strategy === 'upsert' && value.keyFields.length === 0) ctx.addIssue({ code: 'custom', path: ['keyFields'], message: 'Actualizar por clave requiere una clave.' });
});
