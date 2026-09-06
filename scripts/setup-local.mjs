import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const target = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(target)) throw new Error('.env already exists; preserving existing configuration.');
const postgres = randomBytes(24).toString('hex');
const app = randomBytes(24).toString('hex');
const auth = randomBytes(24).toString('hex');
writeFileSync(target, [
  'NODE_ENV=development', 'PORT=4000', 'WEB_ORIGIN=http://127.0.0.1:3000', 'API_INTERNAL_URL=http://127.0.0.1:4000',
  `POSTGRES_PASSWORD=${postgres}`, `ATLAS_APP_PASSWORD=${app}`, `ATLAS_AUTH_PASSWORD=${auth}`,
  `ADMIN_DATABASE_URL=postgresql://postgres:${postgres}@127.0.0.1:54329/atlas`,
  `DATABASE_URL=postgresql://atlas_app:${app}@127.0.0.1:54329/atlas`,
  `AUTH_DATABASE_URL=postgresql://atlas_auth:${auth}@127.0.0.1:54329/atlas`,
  'REDIS_URL=redis://127.0.0.1:63799',
  `AUTH_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`, `AUTH_RATE_KEY=${randomBytes(32).toString('hex')}`,
  'MINIO_ROOT_USER=atlas-local', `MINIO_ROOT_PASSWORD=${randomBytes(24).toString('hex')}`,
  'S3_ENDPOINT=http://127.0.0.1:9009', '',
].join('\n'), { flag: 'wx', mode: 0o600 });
console.log('Local environment created. Secrets were not printed.');
