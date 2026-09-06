import { defineConfig } from 'vitest/config';
export default defineConfig({ esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } }, test: { include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts'], setupFiles: ['tests/setup-integration.ts'], environment: 'node', fileParallelism: false, testTimeout: 15000, hookTimeout: 30000 } });
