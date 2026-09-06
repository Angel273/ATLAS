import { createHmac, timingSafeEqual } from 'node:crypto';
import { Queue, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
export const queueName = process.env.INGESTION_QUEUE ?? 'atlas-ingestion-v1';
export const taskSchema = z.object({ tenantId: z.uuid(), actorId: z.uuid(), versionId: z.uuid(), action: z.enum(['profile', 'import']), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ImportTask = z.infer<typeof taskSchema>;
function signature(task: Omit<ImportTask, 'signature'>) {
  const key = process.env.JOB_SIGNING_KEY ?? process.env.AUTH_RATE_KEY;
  if (!key || key.length < 64) throw new Error('JOB_SIGNING_KEY_REQUIRED');
  return createHmac('sha256', key).update([task.tenantId, task.actorId, task.versionId, task.action].join('|')).digest('hex');
}
export function verifyTask(input: unknown): ImportTask {
  const task = taskSchema.parse(input);
  if (!timingSafeEqual(Buffer.from(task.signature, 'hex'), Buffer.from(signature(task), 'hex'))) throw new Error('INVALID_JOB_SIGNATURE');
  return task;
}
export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:63799');
  return { host: url.hostname, port: Number(url.port || 6379), ...(url.password ? { password: url.password } : {}), maxRetriesPerRequest: null };
}
export class ImportQueue {
  readonly queue = new Queue<ImportTask>(queueName, { connection: redisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 1000 } });
  constructor() { this.queue.on('error', () => console.error(JSON.stringify({ event: 'ingestion.queue_error' }))); }
  async enqueue(task: Omit<ImportTask, 'signature'>) {
    const id = `${task.action}-${task.versionId}`;
    const existing = await this.queue.getJob(id);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') await existing.remove();
      else return;
    }
    await this.queue.add(task.action, { ...task, signature: signature(task) }, { jobId: id });
  }
  async close() { await this.queue.close(); }
}
