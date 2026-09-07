/**
 * @file apps/api/src/bootstrap-admin.ts
 * @description Script de aprovisionamiento del administrador inicial y organización primaria de ATLAS.
 * Valida variables de entorno obligatorias (`ATLAS_ADMIN_EMAIL`, `ATLAS_ADMIN_PASSWORD`, `ATLAS_ORGANIZATION_NAME`),
 * aplica hash scrypt a la contraseña e inserta la membresía inicial con rol 'admin' y registro de auditoría.
 */

import { createPool } from '@atlas/database';
import { z } from 'zod';
import { hashPassword } from './identity/crypto.js';

const input = z.object({
  ATLAS_ADMIN_EMAIL: z.email().max(254).transform(value => value.toLowerCase()),
  ATLAS_ADMIN_PASSWORD: z.string().min(14).max(128),
  ATLAS_ORGANIZATION_NAME: z.string().min(2).max(120),
}).safeParse(process.env);
if (!input.success) {
  console.error('Set ATLAS_ADMIN_EMAIL, ATLAS_ADMIN_PASSWORD (14–128 characters) and ATLAS_ORGANIZATION_NAME.');
  process.exitCode = 1;
} else {
  const pool = createPool(process.env.ADMIN_DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM identity.users WHERE email = $1', [input.data.ATLAS_ADMIN_EMAIL]);
    if (exists.rowCount) throw new Error('ADMIN_ALREADY_EXISTS');
    const organization = await client.query<{ id: string }>('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [input.data.ATLAS_ORGANIZATION_NAME]);
    const user = await client.query<{ id: string }>('INSERT INTO identity.users(email,password_hash) VALUES ($1,$2) RETURNING id', [input.data.ATLAS_ADMIN_EMAIL, await hashPassword(input.data.ATLAS_ADMIN_PASSWORD)]);
    await client.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES ($1,$2,'admin')", [organization.rows[0]?.id, user.rows[0]?.id]);
    await client.query("INSERT INTO audit_events(tenant_id,actor_id,event,correlation_id) VALUES ($1,$2,'admin.provisioned',gen_random_uuid())", [organization.rows[0]?.id, user.rows[0]?.id]);
    await client.query('COMMIT'); console.log('Administrator provisioned. MFA enrollment is required at first login.');
  } catch { await client.query('ROLLBACK'); console.error('Provisioning failed. Existing users are preserved.'); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
}
