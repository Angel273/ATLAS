/**
 * @file eslint.config.mjs
 * @description Configuración central de ESLint (flat config) para el monorepo ATLAS.
 * Aplica reglas estrictas de TypeScript, prohíbe el uso de `any` no justificado y define variables globales de Node.js y navegador.
 */

import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.next-e2e/**', '**/generated/**', '**/next-env.d.ts', 'playwright-report/**', 'test-results/**', '.local/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  } }
);
