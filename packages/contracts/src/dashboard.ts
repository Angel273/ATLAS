/**
 * @file packages/contracts/src/dashboard.ts
 * @description Contratos y esquemas Zod para la configuración de Dashboards gobernados y Widgets interactivos.
 * Define la cuadrícula de 12 columnas (widgetGridSchema), tipología de visualizaciones soportadas
 * (KPI cards, gráficos de líneas, barras, áreas, tablas accesibles y texto informativo), configuraciones avanzadas
 * (líneas de objetivo, formato condicional, columnas calculadas) y versionado inmutable de dashboards.
 */

import { z } from 'zod';

export const widgetTypeSchema = z.enum([

  'kpi_card',
  'line_chart',
  'bar_chart',
  'area_chart',
  'table',
  'text',
]);
export type WidgetType = z.infer<typeof widgetTypeSchema>;

export const widgetGridSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24),
}).strict();
export type WidgetGrid = z.infer<typeof widgetGridSchema>;

export const widgetConfigSchema = z.object({
  color: z.string().max(50).optional(),
  showTargetLine: z.boolean().optional(),
  targetLineValue: z.number().optional(),
  targetLineLabel: z.string().max(80).optional(),
  computedColumn: z.object({
    enabled: z.boolean().default(false),
    name: z.string().max(60).default('Calculada'),
    calculationType: z.enum(['percent_of_target', 'diff_from_target', 'multiply_100', 'custom']).default('percent_of_target'),
    customMultiplier: z.number().optional(),
  }).strict().optional(),
  conditionalFormatting: z.object({
    enabled: z.boolean().default(false),
    greenThreshold: z.number().optional(),
    redThreshold: z.number().optional(),
    mode: z.enum(['badge', 'background', 'bar']).default('badge'),
  }).strict().optional(),
}).strict();
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export const widgetDefinitionSchema = z.object({
  id: z.uuid(),
  type: widgetTypeSchema,
  title: z.string().trim().min(1).max(120),
  kpiVersionId: z.uuid().optional(),
  dimension: z.string().max(63).optional(),
  dateField: z.string().max(63).optional(),
  textContent: z.string().max(2000).optional(),
  grid: widgetGridSchema,
  config: widgetConfigSchema.optional(),
}).strict();
export type WidgetDefinition = z.infer<typeof widgetDefinitionSchema>;

export const dashboardCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  description: z.string().max(1000).default(''),
}).strict();
export type DashboardCreate = z.infer<typeof dashboardCreateSchema>;

export const dashboardVersionCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(1000).default(''),
  layout: z.array(widgetDefinitionSchema).max(50),
  globalFilters: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type DashboardVersionCreate = z.infer<typeof dashboardVersionCreateSchema>;

export const dashboardVersionSchema = dashboardVersionCreateSchema.extend({
  id: z.uuid(),
  dashboardId: z.uuid(),
  accountId: z.uuid().optional(),
  number: z.number().int(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
}).strict();
export type DashboardVersion = z.infer<typeof dashboardVersionSchema>;

export const dashboardSchema = dashboardCreateSchema.extend({
  id: z.uuid(),
  accountId: z.uuid().optional(),
  currentVersionId: z.uuid().nullable(),
  currentVersion: dashboardVersionSchema.nullable().optional(),
  createdAt: z.string(),
}).strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardListSchema = z.object({
  items: z.array(dashboardSchema),
}).strict();
export type DashboardList = z.infer<typeof dashboardListSchema>;

export const dashboardFilterOptionsSchema = z.object({
  supervisors: z.array(z.string()).default([]),
  fms: z.array(z.string()).default([]),
  waves: z.array(z.string()).default([]),
  dateFields: z.array(z.string()).default([]),
}).strict();
export type DashboardFilterOptions = z.infer<typeof dashboardFilterOptionsSchema>;
