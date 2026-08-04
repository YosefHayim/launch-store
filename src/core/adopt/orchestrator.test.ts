import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAdopt,
  type ApplyContext,
  detectTargets,
  planTargets,
  type TargetPlan,
} from './orchestrator.js';
import type { AdoptCatalogApi, AdoptTarget, Adopter, PlannedWrite } from '../types/adopt.js';
import type { AppDescriptor } from '../types/app.js';
import type { InAppPurchaseConfig } from '../types/catalog.js';
const makeApi = (overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi => {
  const base: AdoptCatalogApi = {
    getAppId: () => Effect.succeed('app1'),
    getLatestMarketingVersion: () => Effect.succeed('2.1'),
    getLatestBuildNumber: () => Effect.succeed(12),
    findBundleId: () => Effect.succeed(null),
    listBundleIdCapabilities: () => Effect.succeed([]),
    listProfilesForBundleId: () => Effect.succeed([]),
    listMerchantIds: () => Effect.succeed([]),
    listInAppPurchases: () => Effect.succeed([]),
    listInAppPurchaseLocalizations: () => Effect.succeed([]),
    inAppPurchaseHasPrice: () => Effect.succeed(false),
    listSubscriptionGroups: () => Effect.succeed([]),
    listSubscriptionGroupLocalizations: () => Effect.succeed([]),
    listSubscriptions: () => Effect.succeed([]),
    listSubscriptionLocalizations: () => Effect.succeed([]),
    subscriptionHasPrice: () => Effect.succeed(false),
    listDistributionCertificates: () => Effect.succeed([]),
  };
  return { ...base, ...overrides };
};
const app = (
  name: string,
  bundleId?: string,
  configPath = `/repo/${name}/app.json`,
): AppDescriptor => {
  const appDescriptor: AppDescriptor = { name, dir: `/repo/${name}`, configPath };
  if (bundleId) appDescriptor.bundleId = bundleId;
  return appDescriptor;
};
/** Run local adopt writes with Effect Platform's Node filesystem and path services. */
const runApplyAdopt = (plans: TargetPlan[], applyContext: ApplyContext) =>
  Effect.runPromise(applyAdopt(plans, applyContext).pipe(Effect.provide(NodeContext.layer)));
describe('detectTargets', () => {
  it('separates apps with a live record from those skipped, with a confirming signal', async () => {
    const api = makeApi({
      getAppId: (bundleId: string) => {
        if (bundleId === 'com.acme.good') return Effect.succeed('app-good');
        return Effect.succeed(null);
      },
    });
    const detection = await Effect.runPromise(
      detectTargets(
        api,
        [app('good', 'com.acme.good'), app('norec', 'com.acme.norec'), app('android')],
        {
          keyId: 'K',
          cwd: '/repo',
          hasLaunchConfig: false,
        },
      ),
    );
    expect(detection.detected).toHaveLength(1);
    expect(detection.detected[0]?.signal).toBe('v2.1 live - 12 builds');
    expect(detection.skipped.map((s) => `${s.app.name}: ${s.reason}`)).toEqual([
      'android: no iOS bundle id',
      'norec: no App Store Connect record (create the app once in App Store Connect)',
    ]);
  });
});
describe('planTargets', () => {
  it("collects each adopter's writes and isolates an adopter that throws", async () => {
    const good: Adopter = {
      domain: 'good',
      fidelity: 'importable',
      read: () =>
        Effect.succeed([
          {
            description: 'did a thing',
            fidelity: 'importable',
            change: { home: 'keychain' },
          } satisfies PlannedWrite,
        ]),
    };
    const bad: Adopter = {
      domain: 'bad',
      fidelity: 'detect',
      read: () => Effect.fail(new Error('boom')),
    };
    const detection = {
      detected: [
        {
          target: {
            app: app('good', 'com.acme.good'),
            appId: 'a',
            bundleId: 'com.acme.good',
            keyId: 'K',
            cwd: '/repo',
            hasLaunchConfig: false,
          },
          signal: 'x',
        },
      ],
      skipped: [],
    };
    const [plan] = await Effect.runPromise(planTargets(makeApi(), detection, [good, bad]));
    expect(plan?.writes).toHaveLength(1);
    expect(plan?.errors).toEqual([{ domain: 'bad', message: 'boom' }]);
  });
});
describe('applyAdopt', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-adopt-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const IAP: InAppPurchaseConfig = {
    productId: 'com.acme.coins',
    referenceName: 'Coins',
    type: 'CONSUMABLE',
    localizations: [{ locale: 'en-US', name: 'Coins' }],
  };
  const plan = (target: AdoptTarget, writes: PlannedWrite[]): TargetPlan => ({
    detected: { target, signal: 'x' },
    writes,
    errors: [],
  });
  it('writes a fresh launch.config.ts with the imported products when the repo has none', async () => {
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: false,
    };
    const adoptionSummary = await runApplyAdopt(
      [
        plan(target, [
          {
            description: 'import',
            fidelity: 'importable',
            change: {
              home: 'launch.config',
              bundleId: 'com.acme.app',
              piece: { type: 'iap', iap: IAP },
            },
          },
        ]),
      ],
      {
        cwd: dir,
        hasLaunchConfig: false,
        appRoot: null,
        pullListing: () => Effect.void,
      },
    );
    expect(adoptionSummary.configWritten).toBe(join(dir, 'launch.config.ts'));
    const written = readFileSync(join(dir, 'launch.config.ts'), 'utf8');
    expect(written).toContain('"com.acme.app"');
    expect(written).toContain('"com.acme.coins"');
  });
  it('prints (does not splice) the products block when a launch.config.ts already exists', async () => {
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await runApplyAdopt(
      [
        plan(target, [
          {
            description: 'import',
            fidelity: 'importable',
            change: {
              home: 'launch.config',
              bundleId: 'com.acme.app',
              piece: { type: 'iap', iap: IAP },
            },
          },
        ]),
      ],
      {
        cwd: dir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: () => Effect.void,
      },
    );
    expect(adoptionSummary.configWritten).toBeUndefined();
    expect(adoptionSummary.configBlock).toContain('products: {');
  });
  it("patches a static app.json's entitlements and reports the added keys", async () => {
    const configPath = join(dir, 'app.json');
    writeFileSync(
      configPath,
      JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.acme.app' } } }, null, 2),
    );
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app', configPath),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await runApplyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      {
        cwd: dir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: () => Effect.void,
      },
    );
    expect(adoptionSummary.appJsonPatched).toEqual([
      { app: 'acme', configPath, added: ['aps-environment'] },
    ]);
    const PatchedConfigSchema = Schema.Struct({
      expo: Schema.Struct({
        ios: Schema.Struct({
          entitlements: Schema.Record({ key: Schema.String, value: Schema.String }),
        }),
      }),
    });
    const patchedConfig = Schema.decodeUnknownSync(PatchedConfigSchema)(
      JSON.parse(readFileSync(configPath, 'utf8')),
    );
    expect(patchedConfig.expo.ios.entitlements).toEqual({ 'aps-environment': 'production' });
  });
  it('prints a paste block (writes nothing) for a dynamic app.config.js', async () => {
    const configPath = join(dir, 'app.config.js');
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app', configPath),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: true,
    };
    const adoptionSummary = await runApplyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      {
        cwd: dir,
        hasLaunchConfig: true,
        appRoot: null,
        pullListing: () => Effect.void,
      },
    );
    expect(adoptionSummary.appJsonPatched).toEqual([]);
    expect(adoptionSummary.appJsonBlocks).toHaveLength(1);
    expect(adoptionSummary.appJsonBlocks[0]?.block).toContain('aps-environment');
  });
  it('delegates a listing pull and records success; captures a delegate failure', async () => {
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: true,
    };
    const storeConfig = join(dir, 'store.config.json');
    const writes: PlannedWrite[] = [
      {
        description: 'listing',
        fidelity: 'importable',
        change: {
          home: 'store.config',
          bundleId: 'com.acme.app',
          configPath: storeConfig,
          appName: 'acme',
        },
      },
    ];
    const successfulPull = vi.fn(() => Effect.void);
    const successfulAdoption = await runApplyAdopt([plan(target, writes)], {
      cwd: dir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: successfulPull,
    });
    expect(successfulPull).toHaveBeenCalledWith('com.acme.app', storeConfig);
    expect(successfulAdoption.listingsPulled).toEqual(['acme']);
    const failedPull = vi.fn(() => Effect.fail(new Error('fastlane missing')));
    const failedAdoption = await runApplyAdopt([plan(target, writes)], {
      cwd: dir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: failedPull,
    });
    expect(failedAdoption.listingErrors).toEqual([{ app: 'acme', message: 'fastlane missing' }]);
  });
});
