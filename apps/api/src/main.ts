import { createApp } from './app.js';
const app = await createApp();
await app.listen(Number(process.env.PORT ?? 4000), '127.0.0.1');
console.log(JSON.stringify({ event: 'api.ready', port: Number(process.env.PORT ?? 4000) }));
