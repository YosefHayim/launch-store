/**
 * End-to-end smoke of the COMPILED `launch` binary — the black-box complement to the in-process unit
 * tests. It spawns `dist/cli/index.js` as a real subprocess through the same `core/exec.ts` seam the
 * product uses (`shell: false`, an explicit argv — never a shell string), and asserts exit codes +
 * output on the offline, side-effect-free surface: version / help / explain and the read-only `config`
 * subcommands. `capture` resolves on exit 0 and rejects on any non-zero exit, so resolve-vs-reject IS
 * the exit-code assertion.
 *
 * Runs ONLY via `npm run test:e2e` (its own `vitest.e2e.config.ts`, include `src/**\/*.e2e.ts`), which
 * assumes a built dist — it is NOT part of the default `vitest run` unit pass, and is excluded from the
 * published build (`tsconfig.build.json`) and from coverage (`vitest.config.ts`), exactly like a
 * `*.testkit.ts`. Why not MSW / a network fake: nothing here touches the network — the wire clients are
 * already unit-tested at the fetch seam (`ascClient.test.ts` / `playClient.test.ts`); see ADR 0010.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture } from '../core/exec.js';

/** Absolute path to the built CLI this suite exercises — `<root>/dist/cli/index.js`. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

/** Run the built binary with an explicit argv and return its trimmed stdout (rejects on a non-zero exit). */
const launch = (...args: string[]): Promise<string> => capture('node', [CLI, ...args]);

/** Hermetic scratch dir holding the fixture configs the `config validate` cases point at. */
let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'launch-e2e-'));
  // A minimal schema-valid config (mirrors the built-in DEFAULT_CONFIG's profile shape).
  writeFileSync(
    join(workdir, 'good.json'),
    JSON.stringify({ profiles: { production: { name: 'production', sizeBudgetMB: 200 } } }),
  );
  // Valid but for one unknown top-level key — the root is `additionalProperties: false`, so this is the
  // #197 unknown-key rejection, phrased to survive the #274 zod switch (which reports the key name too).
  writeFileSync(
    join(workdir, 'bad.json'),
    JSON.stringify({ profiles: { production: { name: 'production' } }, totallyBogusKey: true }),
  );
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('launch CLI — offline surface (compiled dist)', () => {
  it('reports its semver version', async () => {
    expect(await launch('--version')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prints help that lists the config command', async () => {
    const help = await launch('--help');
    expect(help).toContain('Usage:');
    expect(help).toContain('config');
  });

  it('explains a glossary topic', async () => {
    expect((await launch('explain', 'csr')).length).toBeGreaterThan(0);
  });

  it('emits a JSON Schema that describes the config', async () => {
    const raw = await launch('config', 'schema');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain('profiles');
  });

  it('prints the config field reference', async () => {
    expect((await launch('config', 'docs')).length).toBeGreaterThan(0);
  });

  it('validates a good config with exit 0', async () => {
    expect(await launch('config', 'validate', join(workdir, 'good.json'))).toContain(
      'Config valid',
    );
  });

  it('rejects a bad config with a non-zero exit that names the offending key', async () => {
    await expect(launch('config', 'validate', join(workdir, 'bad.json'))).rejects.toThrow(
      /totallyBogusKey|unknown|unrecognized/i,
    );
  });
});
