import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit and e2e differ only by file list and timeout.
// https://vitest.dev/guide/projects
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['src/**/*.e2e.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
    ],
  },
});
