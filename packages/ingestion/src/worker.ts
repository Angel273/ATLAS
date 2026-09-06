import { Worker as Thread } from 'node:worker_threads';
import { Worker } from 'bullmq';
import { queueName, redisConnection, verifyTask } from './queue.js';
import { failImport } from './processor.js';
export function startImportWorker() {
  const worker = new Worker(queueName, async job => {
    const task = verifyTask(job.data);
    try {
      await new Promise<void>((resolve, reject) => {
        const thread = new Thread(new URL('./processor-thread.js', import.meta.url), { workerData: task, resourceLimits: { maxOldGenerationSizeMb: 512 }, execArgv: [] });
        const timer = setTimeout(() => { void thread.terminate(); reject(new Error('IMPORT_TIMEOUT')); }, 10 * 60 * 1000);
        thread.once('message', (value: unknown) => { clearTimeout(timer); if (value && typeof value === 'object' && 'ok' in value && value.ok === true) resolve(); else reject(new Error(value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && /^[A-Z_]{3,80}$/.test(value.code) ? value.code : 'IMPORT_FAILED')); });
        thread.once('error', () => { clearTimeout(timer); reject(new Error('IMPORT_RESOURCE_LIMIT')); });
        thread.once('exit', () => { clearTimeout(timer); reject(new Error('IMPORT_WORKER_EXIT')); });
      });
    } catch (error) { await failImport(task, error instanceof Error ? error.message : 'IMPORT_FAILED'); throw error; }
  }, { connection: redisConnection(), concurrency: 2 });
  worker.on('error', () => console.error(JSON.stringify({ event: 'worker.connection_failed' })));
  worker.on('failed', () => console.error(JSON.stringify({ event: 'import.failed' })));
  return worker;
}
