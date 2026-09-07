/**
 * @file packages/contracts/src/workforce.ts
 * @description Contratos y esquemas Zod para la gestión de Workforce / Agent Definer en ATLAS.
 * Modela empleados (códigos de agente, BMS ID, Wave, metadatos dinámicos), catálogos de roles y tipos de contrato,
 * equipos de trabajo, jerarquías y asignaciones con vigencia temporal (valid_from/valid_to),
 * semanas operativas ISO (workforce_weeks, formato YYYY-Www de lunes a domingo) e importación masiva de Rosters Excel.
 */

import { z } from 'zod';

export const employeeStatusSchema = z.enum(['active', 'inactive', 'on_leave']);

export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

export const relationTypeSchema = z.enum([
  'supervisor',
  'mentor',
  'manager',
  'coach',
  'floor_manager',
  'operations_manager',
]);
export type RelationType = z.infer<typeof relationTypeSchema>;

export const attributeDataTypeSchema = z.enum(['string', 'number', 'boolean', 'date']);
export type AttributeDataType = z.infer<typeof attributeDataTypeSchema>;

// --- Workforce Weeks ---
export const workforceWeekStatusSchema = z.enum(['open', 'closed', 'current']);
export type WorkforceWeekStatus = z.infer<typeof workforceWeekStatusSchema>;

export const workforceWeekCreateSchema = z.object({
  weekCode: z.string().regex(/^\d{4}-W\d{2}$/),
  yearNumber: z.number().int(),
  weekNumber: z.number().int().min(1).max(53),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: workforceWeekStatusSchema.default('open'),
  customAttributes: z.record(z.string(), z.any()).optional().default({}),
}).strict();

export const workforceWeekUpdateSchema = z.object({
  status: workforceWeekStatusSchema.optional(),
  customAttributes: z.record(z.string(), z.any()).optional(),
}).strict();

export const workforceWeekSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid().optional(),
  weekCode: z.string().regex(/^\d{4}-W\d{2}$/),
  yearNumber: z.number().int(),
  weekNumber: z.number().int().min(1).max(53),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: workforceWeekStatusSchema,
  customAttributes: z.record(z.string(), z.any()).default({}),
  createdAt: z.string(),
}).strict();

export const workforceWeekListSchema = z.object({
  items: z.array(workforceWeekSchema),
}).strict();

export type WorkforceWeek = z.infer<typeof workforceWeekSchema>;
export type WorkforceWeekCreate = z.infer<typeof workforceWeekCreateSchema>;
export type WorkforceWeekUpdate = z.infer<typeof workforceWeekUpdateSchema>;

// --- Employee Types ---
export const employeeTypeCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  description: z.string().max(1000).default(''),
}).strict();

export const employeeTypeSchema = employeeTypeCreateSchema.extend({
  id: z.uuid(),
  accountId: z.uuid().optional(),
  createdAt: z.string(),
}).strict();

export const employeeTypeListSchema = z.object({
  items: z.array(employeeTypeSchema),
}).strict();

export type EmployeeType = z.infer<typeof employeeTypeSchema>;

// --- Teams ---
export const teamCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  description: z.string().max(1000).default(''),
  accountId: z.uuid().nullable().optional(),
}).strict();

export const teamSchema = teamCreateSchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
}).strict();

export const teamListSchema = z.object({
  items: z.array(teamSchema),
}).strict();

export type Team = z.infer<typeof teamSchema>;

// --- Employees ---
export const employeeCreateSchema = z.object({
  code: z.string().trim().min(1).max(63),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().email().optional().or(z.literal('')),
  status: employeeStatusSchema.default('active'),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  bmsId: z.string().trim().max(63).optional().or(z.literal('')),
  wave: z.string().trim().max(63).optional().or(z.literal('')),
  customFields: z.record(z.string(), z.any()).optional().default({}),
  employeeTypeId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  managerId: z.uuid().optional(),
}).strict();

export const employeeSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid().optional(),
  code: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  normalizedName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  status: employeeStatusSchema,
  hireDate: z.string().nullable().optional(),
  bmsId: z.string().nullable().optional(),
  wave: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.any()).default({}),
  currentEmployeeTypeId: z.uuid().nullable().optional(),
  currentEmployeeTypeName: z.string().nullable().optional(),
  currentTeamId: z.uuid().nullable().optional(),
  currentTeamName: z.string().nullable().optional(),
  currentManagerId: z.uuid().nullable().optional(),
  currentManagerName: z.string().nullable().optional(),
  createdAt: z.string(),
}).strict();

export const employeeListSchema = z.object({
  items: z.array(employeeSchema),
}).strict();

export type Employee = z.infer<typeof employeeSchema>;

// --- Assignments ---
export const employmentAssignmentCreateSchema = z.object({
  employeeId: z.uuid(),
  employeeTypeId: z.uuid(),
  teamId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  weekId: z.uuid().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional().default({}),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
}).strict();

export const employmentAssignmentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeTypeId: z.uuid(),
  employeeTypeName: z.string().optional(),
  teamId: z.uuid().nullable().optional(),
  teamName: z.string().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  weekId: z.uuid().nullable().optional(),
  weekCode: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).default({}),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  createdAt: z.string(),
}).strict();

export const employmentAssignmentListSchema = z.object({
  items: z.array(employmentAssignmentSchema),
}).strict();

export type EmploymentAssignment = z.infer<typeof employmentAssignmentSchema>;

// --- Relationships ---
export const employeeRelationshipCreateSchema = z.object({
  employeeId: z.uuid(),
  managerId: z.uuid(),
  relationType: relationTypeSchema.default('supervisor'),
  weekId: z.uuid().nullable().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
}).strict();

export const employeeRelationshipSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  managerId: z.uuid(),
  managerName: z.string().optional(),
  relationType: relationTypeSchema,
  weekId: z.uuid().nullable().optional(),
  weekCode: z.string().nullable().optional(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  createdAt: z.string(),
}).strict();

export const employeeRelationshipListSchema = z.object({
  items: z.array(employeeRelationshipSchema),
}).strict();

export type EmployeeRelationship = z.infer<typeof employeeRelationshipSchema>;

// --- Team Roster Import via Excel / CSV ---
export const teamRosterSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  isNew: z.boolean(),
  membersCount: z.number().int(),
}).strict();
export type TeamRosterSummary = z.infer<typeof teamRosterSummarySchema>;

export const teamRosterImportInputSchema = z.object({
  filename: z.string().min(1).max(255),
  base64Content: z.string().min(1),
  defaultWeekId: z.uuid().optional(),
  dryRun: z.boolean().default(false),
}).strict();
export type TeamRosterImportInput = z.infer<typeof teamRosterImportInputSchema>;

export const teamRosterImportResultSchema = z.object({
  dryRun: z.boolean(),
  totalRows: z.number().int(),
  teamsCreated: z.number().int(),
  teamsFound: z.number().int(),
  employeesCreated: z.number().int(),
  employeesUpdated: z.number().int(),
  assignmentsCreated: z.number().int(),
  supervisorsLinked: z.number().int(),
  warnings: z.array(z.string()),
  teamsSummary: z.array(teamRosterSummarySchema),
}).strict();
export type TeamRosterImportResult = z.infer<typeof teamRosterImportResultSchema>;

// --- Versioned Rosters & Snapshot Entries ---
export const rosterStatusSchema = z.enum(['uploaded', 'validating', 'ready', 'published', 'failed']);
export type RosterStatus = z.infer<typeof rosterStatusSchema>;

export const rosterVersionSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  accountId: z.uuid(),
  weekId: z.uuid(),
  versionNumber: z.number().int(),
  status: rosterStatusSchema,
  storagePath: z.string().nullable().optional(),
  sha256: z.string().nullable().optional(),
  mapping: z.record(z.string(), z.any()).default({}),
  rowCount: z.number().int().default(0),
  issueCount: z.number().int().default(0),
  createdBy: z.uuid(),
  createdAt: z.string(),
  publishedAt: z.string().nullable().optional(),
}).strict();
export type RosterVersion = z.infer<typeof rosterVersionSchema>;

export const rosterVersionListSchema = z.object({
  items: z.array(rosterVersionSchema),
}).strict();
export type RosterVersionList = z.infer<typeof rosterVersionListSchema>;

export const rosterEntrySchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  accountId: z.uuid(),
  rosterVersionId: z.uuid(),
  employeeId: z.uuid(),
  employeeCode: z.string(),
  bmsId: z.string().nullable().optional(),
  wave: z.string().nullable().optional(),
  teamId: z.uuid().nullable().optional(),
  teamName: z.string().nullable().optional(),
  employeeTypeSlug: z.string().nullable().optional(),
  supervisorId: z.uuid().nullable().optional(),
  supervisorName: z.string().nullable().optional(),
  floorManagerId: z.uuid().nullable().optional(),
  floorManagerName: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).default({}),
  sourceSheet: z.string().nullable().optional(),
  sourceRow: z.number().int().nullable().optional(),
}).strict();
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const rosterEntryListSchema = z.object({
  items: z.array(rosterEntrySchema),
}).strict();
export type RosterEntryList = z.infer<typeof rosterEntryListSchema>;

// --- Dataset Workforce Bindings ---
export const datasetWorkforceBindingSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  accountId: z.uuid(),
  datasetId: z.uuid(),
  datasetVersionId: z.uuid(),
  versionNumber: z.number().int(),
  status: z.enum(['draft', 'published', 'archived']),
  employeeKeyField: z.string(),
  keyType: z.enum(['employee_code', 'bms_id']),
  temporalStrategy: z.enum(['event_date', 'fixed_week']),
  dateField: z.string().nullable().optional(),
  fixedWeekId: z.uuid().nullable().optional(),
  exposedDimensions: z.array(z.string()),
  coverageThreshold: z.number(),
  createdAt: z.string(),
  publishedAt: z.string().nullable().optional(),
}).strict();
export type DatasetWorkforceBinding = z.infer<typeof datasetWorkforceBindingSchema>;

export const createDatasetWorkforceBindingSchema = z.object({
  datasetId: z.uuid(),
  datasetVersionId: z.uuid(),
  employeeKeyField: z.string().min(1),
  keyType: z.enum(['employee_code', 'bms_id']).default('employee_code'),
  temporalStrategy: z.enum(['event_date', 'fixed_week']).default('event_date'),
  dateField: z.string().optional(),
  fixedWeekId: z.uuid().optional(),
  exposedDimensions: z.array(z.string()).default(['supervisor', 'floor_manager', 'wave', 'team']),
  coverageThreshold: z.number().min(0).max(100).default(85),
}).strict();
export type CreateDatasetWorkforceBinding = z.infer<typeof createDatasetWorkforceBindingSchema>;


