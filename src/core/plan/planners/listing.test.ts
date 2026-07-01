import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listingPlanner } from './listing.js';
import { makeAscApiFake } from './ascApiFake.testkit.js';
import type { AscCatalogApi } from '../../ascSync.js';
import type { PlanContext, AppDescriptor, LaunchConfig } from '../../types.js';
import type { AppleLocaleInfo } from '../../storeConfig.js';

/** A fully-stubbed {@link AscCatalogApi}: reads default to "nothing exists yet", writes resolve to a created resource. */
function makeApi(overrides: Partial<AscCatalogApi> = {}): AscCatalogApi {
  const base: AscCatalogApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    findBundleId: vi.fn().mockResolvedValue({ id: 'bundle1', identifier: 'com.acme.alpha' }),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    enableCapability: vi.fn().mockResolvedValue({ id: 'cap-new', capabilityType: 'HEALTHKIT' }),
    disableCapability: vi.fn().mockResolvedValue(undefined),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    createInAppPurchase: vi.fn().mockResolvedValue({ id: 'iap-new' }),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    createInAppPurchaseLocalization: vi.fn().mockResolvedValue({ id: 'iloc' }),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    findInAppPurchasePricePoint: vi
      .fn()
      .mockResolvedValue({ id: 'ipp', customerPrice: '0', territory: 'USA' }),
    createInAppPurchasePriceSchedule: vi.fn().mockResolvedValue(undefined),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    createSubscriptionGroup: vi.fn().mockResolvedValue({ id: 'grp-new', referenceName: 'grp' }),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionGroupLocalization: vi.fn().mockResolvedValue({ id: 'gloc' }),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi.fn().mockResolvedValue({ id: 'sub-new', productId: 'p', name: 'n' }),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    createSubscriptionLocalization: vi.fn().mockResolvedValue({ id: 'sloc' }),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    findSubscriptionPricePoint: vi.fn().mockResolvedValue({ id: 'spp' }),
    createSubscriptionPrice: vi.fn().mockResolvedValue(undefined),
    getEditableAppInfoId: vi.fn().mockResolvedValue('appinfo1'),
    listAppInfoLocalizations: vi.fn().mockResolvedValue([]),
    createAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    updateAppInfoLocalization: vi.fn().mockResolvedValue(undefined),
    getEditableVersionId: vi.fn().mockResolvedValue('version1'),
    listVersionLocalizations: vi.fn().mockResolvedValue([]),
    createVersionLocalization: vi.fn().mockResolvedValue(undefined),
    updateVersionLocalization: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

const tmpDirs: string[] = [];

/** Create a temp app dir holding a `store.config.json` with the given en-US Apple listing, and return it. */
function appDirWithListing(info: AppleLocaleInfo): string {
  const dir = mkdtempSync(join(tmpdir(), 'plan-listing-test-'));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, 'store.config.json'),
    JSON.stringify({ apple: { info: { 'en-US': info } } }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCtx(api: AscCatalogApi | null, appDir: string): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  const app: AppDescriptor = {
    name: 'alpha',
    dir: appDir,
    configPath: join(appDir, 'app.json'),
    bundleId: 'com.acme.alpha',
  };
  return {
    config,
    apps: [app],
    // Widen the catalog-only fake to the full surface API the context now exposes; the listing methods
    // (which these tests assert on) win over the factory's inert defaults via the trailing spread.
    resolveAscApi: () => Promise.resolve(api === null ? null : { ...makeAscApiFake(), ...api }),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

describe('listingPlanner', () => {
  it('omits itself when no app declares a store listing', async () => {
    const plan = await listingPlanner.plan(makeCtx(makeApi(), '/no/such/dir/alpha'));
    expect(plan.state).toBe('omitted');
  });

  it('skips with an actionable hint when no Apple account is active', async () => {
    const plan = await listingPlanner.plan(makeCtx(null, appDirWithListing({ title: 'Acme' })));
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.reason).toMatch(/Apple account/);
    expect(plan.hint).toMatch(/creds/);
  });

  it('reports the per-app diff a fresh listing would create', async () => {
    const dir = appDirWithListing({ title: 'Acme', description: 'The best acme app.' });
    const plan = await listingPlanner.plan(makeCtx(makeApi(), dir));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(
      plan.apps[0]?.actions.some((a) =>
        a.description.startsWith('create listing [en-US] App Info'),
      ),
    ).toBe(true);
    expect(
      plan.apps[0]?.actions.some((a) =>
        a.description.startsWith('create listing [en-US] App Store version'),
      ),
    ).toBe(true);
  });

  it('captures a missing app record as a per-app error, not a thrown plan', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await listingPlanner.plan(makeCtx(api, appDirWithListing({ title: 'Acme' })));
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned' || plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });

  it('is strictly read-only: never invokes a listing write endpoint', async () => {
    const api = makeApi();
    await listingPlanner.plan(
      makeCtx(api, appDirWithListing({ title: 'Acme', description: 'The best acme app.' })),
    );
    expect(api.getEditableAppInfoId).toHaveBeenCalled();
    expect(api.listVersionLocalizations).toHaveBeenCalled();
    expect(api.createAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.updateAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.createVersionLocalization).toHaveBeenCalledTimes(0);
    expect(api.updateVersionLocalization).toHaveBeenCalledTimes(0);
  });
});
