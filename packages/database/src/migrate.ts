import './environment.js';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createPool } from './index.js';

const pool = createPool(process.env.ADMIN_DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('atlas_migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = await client.query<{ checksum: string }>('SELECT checksum FROM public.schema_migrations WHERE name = $1', [name]);
    if (previous.rows[0]) {
      if (previous.rows[0].checksum !== checksum) throw new Error('APPLIED_MIGRATION_CHANGED');
      continue;
    }
    await client.query('BEGIN');
    try { await client.query(sql); await client.query('INSERT INTO public.schema_migrations(name, checksum) VALUES ($1,$2)', [name, checksum]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    console.log(`Applied ${name}`);
  }
  // Fixed role names; PostgreSQL quotes deployment secrets with %L. No user SQL.
  for (const [role, password] of [['atlas_app', process.env.ATLAS_APP_PASSWORD], ['atlas_auth', process.env.ATLAS_AUTH_PASSWORD]] as const) {
    if (!password || password.length < 24) throw new Error('DATABASE_ROLE_SECRET_REQUIRED');
    const result = await client.query<{ statement: string }>("SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS statement", [role, password]);
    const statement = result.rows[0]?.statement;
    if (!statement) throw new Error('DATABASE_ROLE_CONFIGURATION_FAILED');
    await client.query(statement);
  }
  console.log('Database migrations complete.');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('atlas_migrations'))");
  client.release(); await pool.end();
}
