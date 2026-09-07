/**
 * @file packages/database/src/index.ts
 * @description Capa de conexión a PostgreSQL y gestión de contexto transaccional multi-tenant con Row-Level Security (RLS).
 * Proporciona utilidades para la inicialización de pools seguros de conexiones (`pg.Pool`),
 * ejecución de transacciones acotadas por tenant (`withTenant`) mediante la variable de sesión `atlas.tenant_id`,
 * y resolución de contexto de identidad de usuario (`withIdentity`) mediante `atlas.user_id`.
 */

import './environment.js';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
export { PrismaClient } from '@prisma/client';
export type { Pool, PoolClient } from 'pg';

/**
 * Crea y configura un pool de conexiones PostgreSQL con límites seguros de concurrencia y timeouts.
 *
 * @param connectionString Cadena de conexión URI a PostgreSQL.
 * @returns Instancia configurada de Pool.
 * @throws Error si no se especifica la cadena de conexión.
 */
export function createPool(connectionString: string | undefined) {
  if (!connectionString) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
}

/**
 * Ejecuta una operación transaccional dentro del ámbito estricto de un tenant,
 * inyectando la variable de configuración `atlas.tenant_id` requerida por las políticas de PostgreSQL RLS.
 *
 * @param pool Pool de conexiones a PostgreSQL.
 * @param tenantId Identificador UUID v4 del tenant autenticado.
 * @param action Función asíncrona que recibe el cliente de la transacción para ejecutar queries.
 * @returns Resultado de la ejecución de la función `action`.
 */
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

/**
 * Ejecuta una operación transaccional dentro del ámbito estricto de una cuenta y tenant,
 * inyectando las variables de configuración `atlas.tenant_id` y `atlas.account_id` requeridas por las políticas RLS compuestas.
 *
 * @param pool Pool de conexiones a PostgreSQL.
 * @param tenantId Identificador UUID v4 del tenant autenticado.
 * @param accountId Identificador UUID v4 de la cuenta operacional activa.
 * @param action Función asíncrona que recibe el cliente de la transacción para ejecutar queries.
 * @returns Resultado de la ejecución de la función `action`.
 */
export async function withAccount<T>(
  pool: Pool,
  tenantId: string,
  accountId: string,
  action: (transaction: PoolClient) => Promise<T>
): Promise<T> {
  z.uuid().parse(tenantId);
  z.uuid().parse(accountId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('atlas.tenant_id', $1, true), set_config('atlas.account_id', $2, true)",
      [tenantId, accountId]
    );
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Ejecuta una operación transaccional dentro del ámbito de identidad de un usuario,
 * configurando `atlas.user_id` para políticas de seguridad a nivel de membresías y credenciales.
 *
 * @param pool Pool de conexiones a PostgreSQL (usualmente con rol atlas_auth).
 * @param userId Identificador UUID v4 del usuario.
 * @param action Función asíncrona que ejecuta las consultas de identidad.
 * @returns Resultado devuelto por la función `action`.
 */
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

