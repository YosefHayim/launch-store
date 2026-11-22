import { runPlanner } from './planner.testkit.ts';
import { describe, expect, it, vi } from 'vitest';
import { playProductsPlanner } from './playProducts.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AppProducts, InAppPurchaseConfig } from '../../types/catalog.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { PlanContext, PlayCatalogApi } from '../../types/plan.ts';
/** A fully-stubbed {@link PlayCatalogApi}: reads default to "nothing exists yet", writes resolve to void. */
const makePlayApi = (overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi => {
  const base: PlayCatalogApi = {
    assertAppExists: vi.fn(() => Promise.resolve()),
    listInAppProducts: vi.fn(() => Promise.resolve([])),
    insertInAppProduct: vi.fn(() => Promise.resolve()),
    updateInAppProduct: vi.fn(() => Promise.resolve()),
    listSubscriptions: vi.fn(() => Promise.resolve([])),
    createSubscription: vi.fn(() => Promise.resolve()),
    patchSubscription: vi.fn(() => Promise.resolve()),
    activateBasePlan: vi.fn(() => Promise.resolve()),
    listSubscriptionOffers: vi.fn(() => Promise.resolve([])),
    createSubscriptionOffer: vi.fn(() => Promise.resolve()),
    activateSubscriptionOffer: vi.fn(() => Promise.resolve()),
  };
  return { ...base, ...overrides };
};
/** A Play-published in-app product (carries a `play` override); SKU defaults to the shared product id. */
const PLAY_IAP: InAppPurchaseConfig = {
  productId: 'com.acme.coins',
  referenceName: 'Coins',
  type: 'CONSUMABLE',
  localizations: [{ locale: 'en-US', name: 'Coins' }],
  play: {},
};
/** An Apple-only in-app product (no `play` override) - must never reach Play. */
const APPLE_ONLY_IAP: InAppPurchaseConfig = {
  productId: 'com.acme.gems',
  referenceName: 'Gems',
  type: 'CONSUMABLE',
  localizations: [{ locale: 'en-US', name: 'Gems' }],
};
const ALPHA: AppDescriptor = {
  name: 'alpha',
  dir: '/no/such/dir/alpha',
  configPath: '/no/such/dir/alpha/app.json',
  bundleId: 'com.acme.alpha',
  packageName: 'com.acme.alpha',
};
const makeCtx = (
  api: PlayCatalogApi | null,
  products: Record<string, AppProducts> = {},
  apps: AppDescriptor[] = [ALPHA],
): PlanContext => {
  const baseConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  let config = baseConfig;
  if (Object.keys(products).length > 0) config = { ...baseConfig, products };
  return {
    config,
    apps,
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(api),
  };
};
describe('playProductsPlanner', () => {
  it('omits itself when no app declares a Play-overridden product', async () => {
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(makePlayApi(), { 'com.acme.alpha': { inAppPurchases: [APPLE_ONLY_IAP] } }),
    );
    expect(plan.state).toBe('omitted');
  });
  it('omits an app that has products but no Android package name', async () => {
    const noPackage: AppDescriptor = {
      name: 'alpha',
      dir: '/no/such/dir/alpha',
      configPath: '/no/such/dir/alpha/app.json',
      bundleId: 'com.acme.alpha',
    };
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(makePlayApi(), { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }, [noPackage]),
    );
    expect(plan.state).toBe('omitted');
  });
  it('skips with an actionable hint when no Play service account is configured', async () => {
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(null, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(plan.state).toBe('skipped');
    if (plan.state !== 'skipped') return;
    expect(plan.reason).toMatch(/Play service account/);
    expect(plan.hint).toMatch(/android/);
  });
  it('reports the per-app diff a fresh Play product would create', async () => {
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(makePlayApi(), { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0]?.identifier).toBe('com.acme.alpha');
    expect(
      plan.apps[0]?.actions.some((a) => a.description === 'create Play product com.acme.coins'),
    ).toBe(true);
  });
  it('captures an unreachable app as a per-app error, not a thrown plan', async () => {
    const api = makePlayApi({
      assertAppExists: vi.fn(() => Promise.reject(new Error('app not found on Play'))),
    });
    const plan = await runPlanner(
      playProductsPlanner,
      makeCtx(api, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') return;
    if (plan.scope !== 'app') return;
    expect(plan.apps[0]?.error).toMatch(/app not found on Play/);
    expect(plan.apps[0]?.actions).toHaveLength(0);
  });
  it('is strictly read-only: never invokes a Play write endpoint', async () => {
    const api = makePlayApi();
    await runPlanner(
      playProductsPlanner,
      makeCtx(api, { 'com.acme.alpha': { inAppPurchases: [PLAY_IAP] } }),
    );
    expect(api.listInAppProducts).toHaveBeenCalled();
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
    expect(api.updateInAppProduct).toHaveBeenCalledTimes(0);
  });
});
