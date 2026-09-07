/**
 * @file packages/ingestion/src/processor-thread.ts
 * @description Hilo de ejecución worker (`worker_threads`) para aislamiento de CPU y memoria durante la ingesta.
 * Recibe los datos de la tarea desde el hilo padre, ejecuta `processImport` y notifica el resultado o error tipado.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { processImport } from './processor.js';
try { await processImport(workerData); parentPort?.postMessage({ ok: true }); }
catch (error) { parentPort?.postMessage({ ok: false, code: error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'IMPORT_FAILED' }); }

