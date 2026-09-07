/**
 * @file vitest.config.ts
 * @description Configuración de Vitest para la ejecución de pruebas unitarias en el monorepo ATLAS.
 * Incluye pruebas en packages y apps, excluyendo módulos de integración y node_modules.
 */

import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'], environment: 'node' } });

