/**
 * @file playwright.config.ts
 * @description Configuración de Playwright para pruebas E2E en ATLAS.
 * Orquesta servidores de prueba para la API NestJS (:4001) y la aplicación web Next.js (:3001) en entornos aislados.
 */

import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'pnpm --filter @atlas/api exec tsx src/test-server.ts', url: 'http://127.0.0.1:4001/api/v1/health', reuseExistingServer: false, timeout: 60000 },
    { command: 'pnpm --filter @atlas/web exec next dev --port 3001 --hostname 127.0.0.1', url: 'http://127.0.0.1:3001', env: { API_INTERNAL_URL: 'http://127.0.0.1:4001', ATLAS_NEXT_DIST_DIR: '.next-e2e' }, reuseExistingServer: false, timeout: 120000 },
  ],
});
