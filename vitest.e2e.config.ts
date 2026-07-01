/**
 * Vitest config for the end-to-end suite (`npm run test:e2e`).
 *
 * Separate from the default unit config so the e2e specs — which drive the COMPILED `dist/cli/index.js`
 * as a subprocess — never run in the fast `vitest run` unit pass, and so this suite can assume a built
 * dist (the `e2e.yml` workflow, and the local gate, build first). Node environment; a longer per-test
 * timeout because each case spawns the CLI as a child process.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
