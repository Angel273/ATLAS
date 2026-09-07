/**
 * @file vitest.integration.config.ts
 * @description Configuración de Vitest para pruebas de integración con PostgreSQL real, RLS y Redis.
 * Ejecuta pruebas secuenciales (fileParallelism: false) con decoradores TypeScript habilitados y timeouts extendidos.
 */

import { defineConfig } from 'vitest/config';
export default defineConfig({ esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } }, test: { include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts'], setupFiles: ['tests/setup-integration.ts'], environment: 'node', fileParallelism: false, testTimeout: 15000, hookTimeout: 30000 } });

