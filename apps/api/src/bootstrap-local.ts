import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool } from '@atlas/database';
import { hashPassword } from './identity/crypto.js';

const database = new URL(process.env.ADMIN_DATABASE_URL ?? '');
if (process.env.NODE_ENV !== 'development' || !['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/atlas') throw new Error('LOCAL_BOOTSTRAP_ONLY');
const directory = new URL('../../../.local/', import.meta.url);
const accessFile = new URL('admin-access.md', directory);
const email = 'admin@atlas.test';
const password = randomBytes(24).toString('base64url');
const pool = createPool(process.env.ADMIN_DATABASE_URL);
const client = await pool.connect();
let written = false;
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('atlas_local_bootstrap'))");
  const existing = await client.query('SELECT 1 FROM identity.users WHERE email = $1', [email]);
  if (existing.rowCount) throw new Error('LOCAL_ADMIN_ALREADY_EXISTS');
  const org = await client.query<{ id: string }>("INSERT INTO organizations(name) VALUES ('ATLAS · Desarrollo local') RETURNING id");
  const user = await client.query<{ id: string }>('INSERT INTO identity.users(email,password_hash) VALUES ($1,$2) RETURNING id', [email, await hashPassword(password)]);
  await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'admin')", [org.rows[0]?.id, user.rows[0]?.id]);
  await client.query("INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id) VALUES ($1,$2,'admin.provisioned',gen_random_uuid())", [org.rows[0]?.id, user.rows[0]?.id]);
  await mkdir(directory, { recursive: true });
  await writeFile(accessFile, `# Acceso de desarrollo local\n\nURL: http://127.0.0.1:3000/login\n\nCorreo: ${email}\n\nContraseña temporal: ${password}\n\nLa primera entrada exige configurar MFA con tu aplicación de autenticación.\n\nEsta organización es exclusivamente local. No compartas este archivo ni lo subas a Git.\n`, { flag: 'wx', mode: 0o600 });
  written = true;
  await client.query('COMMIT');
  console.log(`Local administrator created. Credentials saved privately to ${fileURLToPath(accessFile)}.`);
} catch {
  await client.query('ROLLBACK');
  if (written) await unlink(accessFile);
  console.error('Local bootstrap not completed. Existing accounts and credential files were preserved.');
  process.exitCode = 1;
} finally { client.release(); await pool.end(); }
