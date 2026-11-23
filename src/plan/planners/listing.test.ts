import { runPlanner } from './planner-testkit.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listingPlanner } from './listing.ts';
import { makeAscApiFake } from '../../testkit/asc-api-fake-testkit.ts';
import type { AscCatalogApi } from '../../store/apple/asc-sync.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { PlanContext } from '../../types/plan.ts';
import type { AppleLocaleInfo } from '../../store/shared/store-config.ts';
import type { ActionStatus } from '../../types/reconcile.ts';

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
function appDirWithListing(localeListing: AppleLocaleInfo): string {
  const systemTemporaryDirectory = tmpdir();
  const planListingTestPath = join(systemTemporaryDirectory, 'plan-listing-test-');
  const dir = mkdtempSync(planListingTestPath);
  tmpDirs.push(dir);
  const storePath = join(dir, 'store.config.json');
  const serialized = JSON.stringify({ apple: { info: { 'en-US': localeListing } } });
  writeFileSync(storePath, serialized);
  return dir;
}
function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);
function makeCtx(api: AscCatalogApi | null, appDir: string): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
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
    resolveAscApi() {
      if (api == null) return Promise.resolve(null);
      const ascApiFake = makeAscApiFake(api);
      return Promise.resolve(ascApiFake);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
  };
}
function describeListingPlanner() {
  async function omitsItselfWhenNoAppDeclaresAStoreListing() {
    const api = makeApi();
    const plan = await runPlanner(listingPlanner, makeCtx(api, '/no/such/dir/alpha'));
    expect(plan.state).toBe('omitted');
  }

  it(
    'omits itself when no app declares a store listing',
    omitsItselfWhenNoAppDeclaresAStoreListing,
  );
  async function skipsWithAnActionableHintWhenNoAppleAccountIsActive() {
    const plan = await runPlanner(
      listingPlanner,
      makeCtx(null, appDirWithListing({ title: 'Acme' })),
    );
    expect(plan.state).toBe('skipped');
    if (plan.state != 'skipped') return;
    expect(plan.reason).toMatch(/Apple account/);
    expect(plan.hint).toMatch(/creds/);
  }

  it(
    'skips with an actionable hint when no Apple account is active',
    skipsWithAnActionableHintWhenNoAppleAccountIsActive,
  );
  async function reportsThePerAppDiffAFreshListingWouldCreate() {
    const dir = appDirWithListing({ title: 'Acme', description: 'The best acme app.' });
    const api = makeApi();
    const plan = await runPlanner(listingPlanner, makeCtx(api, dir));
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    function someA(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description.startsWith('create listing [en-US] App Info');
    }

    expect(plan.apps[0]?.actions.some(someA)).toBe(true);
    function someA2(a: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return a.description.startsWith('create listing [en-US] App Store version');
    }

    expect(plan.apps[0]?.actions.some(someA2)).toBe(true);
  }

  it(
    'reports the per-app diff a fresh listing would create',
    reportsThePerAppDiffAFreshListingWouldCreate,
  );
  async function capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan() {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    const plan = await runPlanner(
      listingPlanner,
      makeCtx(api, appDirWithListing({ title: 'Acme' })),
    );
    expect(plan.state).toBe('planned');
    if (plan.state != 'planned') return;
    if (plan.scope != 'app') return;
    expect(plan.apps[0]?.error).toMatch(/No App Store Connect app record/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  }

  it(
    'captures a missing app record as a per-app error, not a thrown plan',
    capturesAMissingAppPieceAsAPerAppErrorNotAThrownPlan,
  );
  async function isStrictlyReadOnlyNeverInvokesAListingWriteEndpoint() {
    const api = makeApi();
    await runPlanner(
      listingPlanner,
      makeCtx(api, appDirWithListing({ title: 'Acme', description: 'The best acme app.' })),
    );
    expect(api.getEditableAppInfoId).toHaveBeenCalled();
    expect(api.listVersionLocalizations).toHaveBeenCalled();
    expect(api.createAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.updateAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.createVersionLocalization).toHaveBeenCalledTimes(0);
    expect(api.updateVersionLocalization).toHaveBeenCalledTimes(0);
  }

  it(
    'is strictly read-only: never invokes a listing write endpoint',
    isStrictlyReadOnlyNeverInvokesAListingWriteEndpoint,
  );
}

describe('listingPlanner', describeListingPlanner);
