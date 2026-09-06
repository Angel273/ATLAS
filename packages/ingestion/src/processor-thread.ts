import { parentPort, workerData } from 'node:worker_threads';
import { processImport } from './processor.js';
try { await processImport(workerData); parentPort?.postMessage({ ok: true }); }
catch (error) { parentPort?.postMessage({ ok: false, code: error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'IMPORT_FAILED' }); }
