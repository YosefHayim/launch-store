import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./src/', import.meta.url)),
      },
      {
        find: '@apple',
        replacement: fileURLToPath(new URL('./src/apple', import.meta.url)),
      },
      {
        find: '@cli',
        replacement: fileURLToPath(new URL('./src/cli', import.meta.url)),
      },
      {
        find: '@core',
        replacement: fileURLToPath(new URL('./src/core', import.meta.url)),
      },
      {
        find: '@google',
        replacement: fileURLToPath(new URL('./src/google', import.meta.url)),
      },
      {
        find: '@providers',
        replacement: fileURLToPath(new URL('./src/providers', import.meta.url)),
      },
      {
        find: '@testkit',
        replacement: fileURLToPath(new URL('./src/testkit', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    forceRerunTriggers: ['**/{vitest,vite}.config.*'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.testkit.ts',
        'src/**/*.e2e.ts',
        'src/cli/**',
        'src/index.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
});
