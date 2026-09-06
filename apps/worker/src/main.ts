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
