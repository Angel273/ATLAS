/**
 * @file apps/api/src/test-server.ts
 * @description Servidor aislado para pruebas E2E (End-to-End con Playwright).
 * Opera exclusivamente sobre la base de datos local de test (`atlas_test`), semillas sintéticas
 * y buckets efímeros para evitar tocar datos de desarrollo o producción.
 */

// Isolated E2E server. Never loads or resets the application database.
import { createPool } from '@atlas/database';
import { hashPassword } from './identity/crypto.js';

for (const key of ['ADMIN_DATABASE_URL', 'DATABASE_URL', 'AUTH_DATABASE_URL']) {
  const url = new URL(process.env[key] ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('E2E_REQUIRES_LOCAL_DATABASE');
  url.pathname = '/atlas_test'; process.env[key] = url.toString();
}
process.env.NODE_ENV = 'test';
process.env.INGESTION_QUEUE = 'atlas-ingestion-e2e';
process.env.S3_BUCKET = 'atlas-e2e-originals';
process.env.WEB_ORIGIN = 'http://127.0.0.1:3001';
const pool = createPool(process.env.ADMIN_DATABASE_URL);
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('atlas_e2e_seed'))");
    const user = await client.query<{ id: string }>(`INSERT INTO identity.users(email,password_hash) VALUES ('e2e-admin@example.invalid',$1)
      ON CONFLICT(email) DO UPDATE SET password_hash = EXCLUDED.password_hash, mfa_enabled = false, mfa_secret = NULL, last_totp_step = -1 RETURNING id`, [await hashPassword('Synthetic-E2E-password-ONLY-123!')]);
    const id = user.rows[0]?.id;
    await client.query('DELETE FROM identity.sessions WHERE user_id = $1', [id]);
    const membership = await client.query('SELECT 1 FROM identity.memberships WHERE user_id = $1', [id]);
    if (!membership.rowCount) {
      const tenant = await client.query<{ id: string }>("INSERT INTO organizations(name) VALUES ('Organización E2E sintética') RETURNING id");
      await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'admin')", [tenant.rows[0]?.id, id]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
} finally { await pool.end(); }
const { createApp } = await import('./app.js');
const app = await createApp(); await app.listen(4001, '127.0.0.1');
const { startImportWorker } = await import('@atlas/ingestion');
const worker = startImportWorker();
process.once('SIGTERM',()=>{void worker.close();});
process.once('SIGINT',()=>{void worker.close();});
