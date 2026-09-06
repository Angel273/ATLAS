import '../packages/database/src/environment.js';
for (const key of ['ADMIN_DATABASE_URL', 'DATABASE_URL', 'AUTH_DATABASE_URL']) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}. Run local setup and db:test:prepare.`);
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Integration tests require local PostgreSQL.');
  url.pathname = '/atlas_test'; process.env[key] = url.toString();
}
process.env.NODE_ENV = 'test';
process.env.INGESTION_QUEUE = 'atlas-ingestion-integration';
process.env.S3_BUCKET = 'atlas-test-originals';
process.env.AI_PROVIDER = 'mock';
