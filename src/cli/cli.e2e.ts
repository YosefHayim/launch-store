import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCommandOutput, provideNodeCommandServices } from '../core/services/exec.js';
/** Absolute path to the built CLI this suite exercises - `<root>/dist/cli/index.js`. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
/** Run the built binary with an explicit argv and return its trimmed stdout (rejects on a non-zero exit). */
const launch = (...args: string[]): Promise<string> =>
  Effect.runPromise(provideNodeCommandServices(captureCommandOutput('node', [CLI, ...args])));
/** Hermetic scratch dir holding the fixture configs the `config validate` cases point at. */
let workdir: string;
beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'launch-e2e-'));
  // A minimal schema-valid config (mirrors the built-in DEFAULT_CONFIG's profile shape).
  writeFileSync(
    join(workdir, 'good.json'),
    JSON.stringify({
      profiles: { production: { name: 'production', sizeBudgetMB: 200 } },
      products: {
        'com.acme-app': {
          inAppPurchases: [
            {
              productId: 'com.acme.coins_100',
              referenceName: 'Coins',
              type: 'CONSUMABLE',
              localizations: [{ locale: 'en-US', name: 'Coins' }],
            },
          ],
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro.monthly2',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  // Valid but for one unknown top-level key - the root is `additionalProperties: false`, so this is the
  // #197 unknown-key rejection, phrased to survive the #274 zod switch (which reports the key name too).
  writeFileSync(
    join(workdir, 'bad.json'),
    JSON.stringify({ profiles: { production: { name: 'production' } }, totallyBogusKey: true }),
  );
  writeFileSync(
    join(workdir, 'bad-product-id.json'),
    JSON.stringify({
      profiles: { production: { name: 'production' } },
      products: {
        'com.acme-app': {
          inAppPurchases: [
            {
              productId: 'com.acme.coins-100',
              referenceName: 'Coins',
              type: 'CONSUMABLE',
              localizations: [{ locale: 'en-US', name: 'Coins' }],
            },
          ],
          subscriptionGroups: [
            {
              referenceName: 'Pro',
              localizations: [{ locale: 'en-US', name: 'Pro' }],
              subscriptions: [
                {
                  productId: 'com.acme.pro-monthly',
                  referenceName: 'Monthly',
                  subscriptionPeriod: 'ONE_MONTH',
                  localizations: [{ locale: 'en-US', name: 'Pro Monthly' }],
                },
              ],
            },
          ],
        },
      },
    }),
  );
});
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});
describe('launch CLI - offline surface (compiled dist)', () => {
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
  it('rejects invalid Apple product IDs and explains the allowed characters', async () => {
    await expect(
      launch('config', 'validate', join(workdir, 'bad-product-id.json')),
    ).rejects.toThrow(/productId.*only letters, digits, underscores, and periods/i);
  });
});
