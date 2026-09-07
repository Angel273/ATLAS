/**
 * @file packages/database/src/prepare-test.ts
 * @description Script de inicialización de la base de datos de pruebas (`atlas_test`).
 * Garantiza que la ejecución sea en entorno local, crea la base de datos si no existe
 * y ejecuta el pipeline de migraciones para dejar el entorno de integración listo.
 */

import './environment.js';
import { createPool } from './index.js';

const original = process.env.ADMIN_DATABASE_URL;
if (!original) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
const url = new URL(original);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('TEST_DATABASE_MUST_BE_LOCAL');
const pool = createPool(original);
try {
  const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'atlas_test'");
  if (!exists.rowCount) await pool.query('CREATE DATABASE atlas_test');
} finally { await pool.end(); }
url.pathname = '/atlas_test';
process.env.ADMIN_DATABASE_URL = url.toString();
await import('./migrate.js');
