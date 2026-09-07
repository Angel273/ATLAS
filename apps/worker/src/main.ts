/**
 * @file apps/worker/src/main.ts
 * @description Punto de entrada ejecutable del servicio Worker en segundo plano (@atlas/worker).
 * Inicializa el contexto NestJS en modo sin servidor HTTP, levanta el consumidor BullMQ de ingesta
 * (`startImportWorker`) y maneja señales de terminación segura (`SIGTERM`, `SIGINT`) para un apagado limpio.
 */

import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { startImportWorker } from '@atlas/ingestion';
@Module({})
class WorkerModule {}

const app = await NestFactory.createApplicationContext(WorkerModule, {logger:false});
const worker = startImportWorker();
await worker.waitUntilReady();
console.log(JSON.stringify({event:'worker.ready',ingestionEnabled:true}));
async function shutdown() { await worker.close(); await app.close(); }
process.once('SIGTERM',()=>{void shutdown();});
process.once('SIGINT',()=>{void shutdown();});
