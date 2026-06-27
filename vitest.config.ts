/**
 * Vitest configuration.
 *
 * Tests live beside the code they cover (`src/**\/*.test.ts`) and run in a Node environment, since
 * Launch is a CLI that shells out and talks to the filesystem/network. Coverage excludes the test
 * files themselves and the thin `src/cli` commander wiring (exercised end-to-end via the dry-run
 * pipeline test rather than unit-tested). The text-summary reporter is what CI surfaces in its
 * run summary.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.testkit.ts',
        'src/cli/**',
        'src/index.ts',
        'src/core/types.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
});
