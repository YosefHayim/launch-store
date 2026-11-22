import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));
const packageEntry = fileURLToPath(new URL('./src/index.ts', import.meta.url));
const endToEndTimeoutMilliseconds = 30_000;

function sourceFolder(folder: string): string {
  return fileURLToPath(new URL(`./src/${folder}`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: sourceRoot },
      { find: '@apple', replacement: sourceFolder('apple') },
      { find: '@cli', replacement: sourceFolder('cli') },
      { find: '@google', replacement: sourceFolder('google') },
      { find: '@providers', replacement: sourceFolder('providers') },
      { find: '@testkit', replacement: sourceFolder('testkit') },
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
        'src/**/*.testkit.ts',
        'e2e/**/*.e2e.ts',
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
          include: ['e2e/**/*.e2e.ts'],
          testTimeout: endToEndTimeoutMilliseconds,
        },
      },
    ],
  },
});
