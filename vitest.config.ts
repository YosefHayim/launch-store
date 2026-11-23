import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageEntry = fileURLToPath(new URL('./src/index.ts', import.meta.url));
const endToEndTimeoutMilliseconds = 30_000;

export default defineConfig({
  resolve: {
    alias: [
      // Vitest loads a user's launch.config.ts itself, so Node's resolve hook never sees `launch-store`.
      { find: /^launch-store$/, replacement: packageEntry },
    ],
  },
  test: {
    environment: 'node',
    forceRerunTriggers: ['**/{vitest,vite}.config.*'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*-testkit.ts',
        'e2e/**/*-e2e.ts',
        'src/cli/**',
        'src/index.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
    // End-to-end runs the built CLI, so `pnpm test` stays on the unit project.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['e2e/**/*-e2e.ts'],
          testTimeout: endToEndTimeoutMilliseconds,
        },
      },
    ],
  },
});
