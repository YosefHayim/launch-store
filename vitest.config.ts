import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@apple': fileURLToPath(new URL('./src/apple', import.meta.url)),
      '@cli': fileURLToPath(new URL('./src/cli', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@google': fileURLToPath(new URL('./src/google', import.meta.url)),
      '@providers': fileURLToPath(new URL('./src/providers', import.meta.url)),
      '@testkit': fileURLToPath(new URL('./src/testkit', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.testkit.ts',
        'src/**/*.e2e.ts',
        'src/cli/**',
        'src/index.ts',
        'src/core/types.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
});
