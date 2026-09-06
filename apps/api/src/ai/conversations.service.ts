import { z } from 'zod';
import { createPool, withTenant, type Pool } from '@atlas/database';
import {
  DomainError,
  conversationSchema,
  conversationCreateSchema,
  conversationListSchema,
  conversationDetailSchema,
  conversationMessageSchema,
  sendMessageSchema,
  toolExecutionSchema,
  type DataActor,
  type GroundingCitation,
} from '@atlas/contracts';
import { permit, audit } from '@atlas/ingestion';
import { KpiService } from '@atlas/kpi';
import { IngestionService } from '@atlas/ingestion';
import { WorkforceService } from '../workforce/workforce.service.js';
import { DashboardsService } from '../dashboards/dashboards.service.js';
import { TOOL_DEFINITIONS, executeTool, type ToolServices } from './tools.js';
import { getAIProvider, type AIMessage } from './provider.js';

const convSelect = `SELECT id, tenant_id AS "tenantId", user_id AS "userId", title, created_at::text AS "createdAt", updated_at::text AS "updatedAt" FROM conversations`;
const msgSelect = `SELECT id, conversation_id AS "conversationId", role, content, grounding_context AS "groundingContext", tokens_used AS "tokensUsed", created_at::text AS "createdAt" FROM conversation_messages`;
const toolExecSelect = `SELECT id, conversation_id AS "conversationId", message_id AS "messageId", tool_name AS "toolName", parameters_redacted AS "parametersRedacted", result_summary AS "resultSummary", duration_ms AS "durationMs", status, created_at::text AS "createdAt" FROM conversation_tool_executions`;

export class ConversationsService {
  readonly pool: Pool = createPool(process.env.DATABASE_URL);
  private readonly toolServices: ToolServices;

  constructor(
    kpi: KpiService,
    ingestion: IngestionService,
    workforce: WorkforceService,
    dashboards: DashboardsService
  ) {
    this.toolServices = { kpi, ingestion, workforce, dashboards };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  getModelInfo() {
    const provider = getAIProvider();
    const isMock = provider.name.startsWith('mock');
    const configuredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    return {
      provider: isMock ? 'mock' : 'google-gemini',
      model: isMock ? 'Motor determinista local' : configuredModel,
      activeProviderName: provider.name,
    };
  }

  async list(actor: DataActor) {
    permit(actor, 'ai.use');
    return withTenant(this.pool, actor.tenantId, async client => {
      const rows = (await client.query(
        `${convSelect} WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
        [actor.userId]
      )).rows;
      return conversationListSchema.parse({ items: rows });
    });
  }

  async create(actor: DataActor, body: unknown, correlation: string) {
    permit(actor, 'ai.use');
    const input = conversationCreateSchema.parse(body || {});
    const title = input.title?.trim() || 'Nueva consulta operacional';

    return withTenant(this.pool, actor.tenantId, async client => {
      const row = (await client.query(
        `INSERT INTO conversations (tenant_id, user_id, title)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id AS "tenantId", user_id AS "userId", title, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`,
        [actor.tenantId, actor.userId, title]
      )).rows[0];

      await audit(client, actor, 'ai.conversation_created', row.id, correlation);
      return conversationSchema.parse(row);
    });
  }

  async get(actor: DataActor, conversationId: string) {
    permit(actor, 'ai.use');
    z.uuid().parse(conversationId);

    return withTenant(this.pool, actor.tenantId, async client => {
      const convRow = (await client.query(
        `${convSelect} WHERE id = $1 AND user_id = $2`,
        [conversationId, actor.userId]
      )).rows[0];

      if (!convRow) {
        throw new DomainError('CONVERSATION_NOT_FOUND', 404, 'Conversación no encontrada.');
      }

      const messages = (await client.query(
        `${msgSelect} WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [conversationId]
      )).rows;

      const toolExecutions = (await client.query(
        `${toolExecSelect} WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [conversationId]
      )).rows;

      return conversationDetailSchema.parse({
        conversation: convRow,
        messages,
        toolExecutions,
      });
    });
  }

  async sendMessage(actor: DataActor, conversationId: string, body: unknown, correlation: string) {
    permit(actor, 'ai.use');
    z.uuid().parse(conversationId);
    const input = sendMessageSchema.parse(body);

    return withTenant(this.pool, actor.tenantId, async client => {
      const convRow = (await client.query(
        `${convSelect} WHERE id = $1 AND user_id = $2`,
        [conversationId, actor.userId]
      )).rows[0];

      if (!convRow) {
        throw new DomainError('CONVERSATION_NOT_FOUND', 404, 'Conversación no encontrada.');
      }

      // 1. Persist user message
      const userMsgRow = (await client.query(
        `INSERT INTO conversation_messages (tenant_id, conversation_id, role, content)
         VALUES ($1, $2, 'user', $3)
         RETURNING id, conversation_id AS "conversationId", role, content, grounding_context AS "groundingContext", tokens_used AS "tokensUsed", created_at::text AS "createdAt"`,
        [actor.tenantId, conversationId, input.content]
      )).rows[0];

      // Auto-update conversation title if it was the default and this is first message
      if (convRow.title === 'Nueva consulta operacional') {
        const shortTitle = input.content.slice(0, 45).replace(/[\r\n]+/g, ' ').trim() + (input.content.length > 45 ? '…' : '');
        await client.query(`UPDATE conversations SET title = $1 WHERE id = $2`, [shortTitle, conversationId]);
      }

      // 2. Load recent conversation history for prompt context
      const historyRows = (await client.query(
        `${msgSelect} WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 30`,
        [conversationId]
      )).rows;

      const aiMessages: AIMessage[] = historyRows.map((r: any) => ({
        role: r.role,
        content: r.content,
      }));

      // 3. Tool execution loop (max 5 turns)
      const provider = getAIProvider();
      const accumulatedCitations: GroundingCitation[] = [];
      let totalTokens = 0;
      let finalContent = '';
      let iterations = 0;
      const maxTurns = 5;

      while (iterations < maxTurns) {
        iterations++;
        const aiResponse = await provider.generate(aiMessages, TOOL_DEFINITIONS);
        totalTokens += aiResponse.tokensUsed;

        if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
          aiMessages.push({
            role: 'assistant',
            content: aiResponse.content,
            toolCalls: aiResponse.toolCalls,
            rawParts: aiResponse.rawParts,
          });

          for (const tc of aiResponse.toolCalls) {
            const { result, citations, execution } = await executeTool(
              this.toolServices,
              actor,
              conversationId,
              tc.name,
              tc.arguments,
              correlation
            );
            accumulatedCitations.push(...citations);

            await client.query(
              `INSERT INTO conversation_tool_executions(
                tenant_id, conversation_id, tool_name, parameters_redacted, result_summary, duration_ms, status
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                actor.tenantId,
                conversationId,
                execution.toolName,
                JSON.stringify(execution.parametersRedacted),
                JSON.stringify(execution.resultSummary),
                execution.durationMs,
                execution.status,
              ]
            );

            aiMessages.push({
              role: 'tool',
              name: tc.name,
              content: JSON.stringify(result),
            });
          }
        } else {
          finalContent = aiResponse.content;
          break;
        }
      }

      if (!finalContent) {
        finalContent = 'Se ha alcanzado el límite máximo de consultas de herramientas permitidas para este turno. Por favor, especifica una consulta más acotada.';
      }

      // Deduplicate citations
      const uniqueCitations = deduplicateCitations(accumulatedCitations);

      // 4. Persist assistant message
      const asstMsgRow = (await client.query(
        `INSERT INTO conversation_messages (tenant_id, conversation_id, role, content, grounding_context, tokens_used)
         VALUES ($1, $2, 'assistant', $3, $4, $5)
         RETURNING id, conversation_id AS "conversationId", role, content, grounding_context AS "groundingContext", tokens_used AS "tokensUsed", created_at::text AS "createdAt"`,
        [
          actor.tenantId,
          conversationId,
          finalContent,
          JSON.stringify(uniqueCitations),
          totalTokens,
        ]
      )).rows[0];

      await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
      await audit(client, actor, 'ai.message_sent', conversationId, correlation);

      return {
        userMessage: conversationMessageSchema.parse(userMsgRow),
        assistantMessage: conversationMessageSchema.parse(asstMsgRow),
      };
    });
  }
}

function deduplicateCitations(citations: GroundingCitation[]): GroundingCitation[] {
  const seen = new Set<string>();
  const result: GroundingCitation[] = [];
  for (const c of citations) {
    const key = `${c.title}:${c.kpiVersionId || ''}:${c.queryHash || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}
