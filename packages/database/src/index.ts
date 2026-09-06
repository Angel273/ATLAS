import './environment.js';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
export { PrismaClient } from '@prisma/client';
export type { Pool, PoolClient } from 'pg';

export function createPool(connectionString: string | undefined) {
  if (!connectionString) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
}
export async function withTenant<T>(pool: Pool, tenantId: string, action: (transaction: PoolClient) => Promise<T>): Promise<T> {
  z.uuid().parse(tenantId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('atlas.tenant_id', $1, true)", [tenantId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export async function withIdentity<T>(pool: Pool, userId: string, action: (transaction: PoolClient) => Promise<T>): Promise<T> {
  z.uuid().parse(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('atlas.user_id', $1, true)", [userId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
