/**
 * @file packages/contracts/src/ai.ts
 * @description Esquemas y contratos Zod para el módulo de IA Multi-Proveedor (AI Chat Operacional).
 * Define roles de mensaje, tipología de afirmaciones y citas verificadas (grounding context con kpiVersionId,
 * datasetVersionId, hash de consulta), esquema de conversaciones, turnos, ejecuciones de herramientas
 * de solo lectura auditadas y sanitización estricta de parámetros sin filtración de datos confidenciales.
 */

import { z } from 'zod';

export const messageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export const factTypeSchema = z.enum(['fact', 'calculation', 'interpretation', 'structure']);
export type FactType = z.infer<typeof factTypeSchema>;

export const groundingCitationSchema = z.object({
  kpiVersionId: z.string().uuid().optional(),
  kpiSlug: z.string().optional(),
  datasetVersionId: z.string().uuid().optional(),
  datasetSlug: z.string().optional(),
  queryHash: z.string().optional(),
  timeRange: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
  title: z.string(),
  factType: factTypeSchema,
}).strict();
export type GroundingCitation = z.infer<typeof groundingCitationSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(255),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
}).strict();
export type ConversationCreate = z.infer<typeof conversationCreateSchema>;

export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
}).strict();
export type ConversationList = z.infer<typeof conversationListSchema>;

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  groundingContext: z.array(groundingCitationSchema).default([]),
  tokensUsed: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
}).strict();
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationMessageListSchema = z.object({
  items: z.array(conversationMessageSchema),
}).strict();

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
}).strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const toolExecutionSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid().nullable().optional(),
  toolName: z.string().min(1).max(80),
  parametersRedacted: z.record(z.string(), z.unknown()),
  resultSummary: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['success', 'error']),
  createdAt: z.string(),
}).strict();
export type ToolExecution = z.infer<typeof toolExecutionSchema>;

export const toolExecutionListSchema = z.object({
  items: z.array(toolExecutionSchema),
}).strict();

export const conversationDetailSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(conversationMessageSchema),
  toolExecutions: z.array(toolExecutionSchema),
}).strict();
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
