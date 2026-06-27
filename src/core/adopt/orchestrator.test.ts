import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAdopt, detectTargets, planTargets, type TargetPlan } from './orchestrator.js';
import type { Adopter, AdoptCatalogApi, AdoptTarget, PlannedWrite } from './types.js';
import type { AppDescriptor, InAppPurchaseConfig } from '../types.js';

function makeApi(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const base: AdoptCatalogApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    getLatestMarketingVersion: vi.fn().mockResolvedValue('2.1'),
    getLatestBuildNumber: vi.fn().mockResolvedValue(12),
    findBundleId: vi.fn().mockResolvedValue(null),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    listProfilesForBundleId: vi.fn().mockResolvedValue([]),
    listMerchantIds: vi.fn().mockResolvedValue([]),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    listDistributionCertificates: vi.fn().mockResolvedValue([]),
  };
  return { ...base, ...overrides };
}

const app = (
  name: string,
  bundleId?: string,
  configPath = `/repo/${name}/app.json`,
): AppDescriptor => ({
  name,
  dir: `/repo/${name}`,
  configPath,
  ...(bundleId ? { bundleId } : {}),
});

describe('detectTargets', () => {
  it('separates apps with a live record from those skipped, with a confirming signal', async () => {
    const api = makeApi({
      getAppId: vi
        .fn()
        .mockImplementation((bundleId: string) =>
          Promise.resolve(bundleId === 'com.acme.good' ? 'app-good' : null),
        ),
    });
    const detection = await detectTargets(
      api,
      [app('good', 'com.acme.good'), app('norec', 'com.acme.norec'), app('android')],
      {
        keyId: 'K',
        cwd: '/repo',
        hasLaunchConfig: false,
      },
    );

    expect(detection.detected).toHaveLength(1);
    expect(detection.detected[0]?.signal).toBe('v2.1 live · 12 builds');
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
      read: vi.fn().mockResolvedValue([
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
      read: vi.fn().mockRejectedValue(new Error('boom')),
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

    const [plan] = await planTargets(makeApi(), detection, [good, bad]);

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

  function plan(target: AdoptTarget, writes: PlannedWrite[]): TargetPlan {
    return { detected: { target, signal: 'x' }, writes, errors: [] };
  }

  it('writes a fresh launch.config.ts with the imported products when the repo has none', async () => {
    const target: AdoptTarget = {
      app: app('acme', 'com.acme.app'),
      appId: 'a',
      bundleId: 'com.acme.app',
      keyId: 'K',
      cwd: dir,
      hasLaunchConfig: false,
    };
    const result = await applyAdopt(
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
      { cwd: dir, hasLaunchConfig: false, appRoot: null, pullListing: vi.fn() },
    );

    expect(result.configWritten).toBe(join(dir, 'launch.config.ts'));
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
    const result = await applyAdopt(
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
      { cwd: dir, hasLaunchConfig: true, appRoot: null, pullListing: vi.fn() },
    );

    expect(result.configWritten).toBeUndefined();
    expect(result.configBlock).toContain('products: {');
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

    const result = await applyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      { cwd: dir, hasLaunchConfig: true, appRoot: null, pullListing: vi.fn() },
    );

    expect(result.appJsonPatched).toEqual([
      { app: 'acme', configPath, added: ['aps-environment'] },
    ]);
    const patched = JSON.parse(readFileSync(configPath, 'utf8')) as {
      expo: { ios: { entitlements: Record<string, string> } };
    };
    expect(patched.expo.ios.entitlements).toEqual({ 'aps-environment': 'production' });
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

    const result = await applyAdopt(
      [
        plan(target, [
          {
            description: 'ent',
            fidelity: 'advisory',
            change: { home: 'app.json', configPath, key: 'aps-environment', value: 'production' },
          },
        ]),
      ],
      { cwd: dir, hasLaunchConfig: true, appRoot: null, pullListing: vi.fn() },
    );

    expect(result.appJsonPatched).toEqual([]);
    expect(result.appJsonBlocks).toHaveLength(1);
    expect(result.appJsonBlocks[0]?.block).toContain('aps-environment');
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

    const ok = vi.fn().mockResolvedValue(undefined);
    const okResult = await applyAdopt([plan(target, writes)], {
      cwd: dir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: ok,
    });
    expect(ok).toHaveBeenCalledWith('com.acme.app', storeConfig);
    expect(okResult.listingsPulled).toEqual(['acme']);

    const fail = vi.fn().mockRejectedValue(new Error('fastlane missing'));
    const failResult = await applyAdopt([plan(target, writes)], {
      cwd: dir,
      hasLaunchConfig: true,
      appRoot: null,
      pullListing: fail,
    });
    expect(failResult.listingErrors).toEqual([{ app: 'acme', message: 'fastlane missing' }]);
  });
});
