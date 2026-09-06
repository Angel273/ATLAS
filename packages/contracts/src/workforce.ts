import { z } from 'zod';

export const employeeStatusSchema = z.enum(['active', 'inactive', 'on_leave']);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;

export const relationTypeSchema = z.enum(['supervisor', 'mentor', 'manager', 'coach']);
export type RelationType = z.infer<typeof relationTypeSchema>;

export const attributeDataTypeSchema = z.enum(['string', 'number', 'boolean', 'date']);
export type AttributeDataType = z.infer<typeof attributeDataTypeSchema>;

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
  employeeTypeId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  managerId: z.uuid().optional(),
}).strict();

export const employeeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable().optional(),
  status: employeeStatusSchema,
  hireDate: z.string().nullable().optional(),
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
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
}).strict();

export const employeeRelationshipSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  managerId: z.uuid(),
  managerName: z.string().optional(),
  relationType: relationTypeSchema,
  validFrom: z.string(),
  validTo: z.string().nullable(),
  createdAt: z.string(),
}).strict();

export const employeeRelationshipListSchema = z.object({
  items: z.array(employeeRelationshipSchema),
}).strict();

export type EmployeeRelationship = z.infer<typeof employeeRelationshipSchema>;
