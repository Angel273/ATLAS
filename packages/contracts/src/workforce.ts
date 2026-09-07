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

