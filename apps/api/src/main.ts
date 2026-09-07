/**
 * @file apps/api/src/main.ts
 * @description Punto de entrada ejecutable del servidor backend Fastify/NestJS (@atlas/api).
 * Arranca la aplicación en el puerto configurado (por defecto 4000) enlazando a la interfaz loopback 127.0.0.1.
 */

import { createApp } from './app.js';
const app = await createApp();
await app.listen(Number(process.env.PORT ?? 4000), '127.0.0.1');
console.log(JSON.stringify({ event: 'api.ready', port: Number(process.env.PORT ?? 4000) }));

