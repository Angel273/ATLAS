/**
 * @file packages/ingestion/src/index.ts
 * @description Punto de entrada y re-exportaciones principales del paquete de ingesta (@atlas/ingestion).
 * Expone servicios de repositorio transaccional, almacenamiento de objetos S3, colas BullMQ,
 * algoritmos de normalización determinista y workers de procesamiento en segundo plano.
 */

export * from './repository.js';
export * from './storage.js';
export * from './queue.js';
export * from './normalize.js';
export * from './worker.js';
export * from './ai-column.js';

