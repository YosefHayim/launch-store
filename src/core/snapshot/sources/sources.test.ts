import { describe, expect, it, vi } from 'vitest';
import { appleProductsSource } from './appleProducts.js';
import { appleSubscriptionsSource } from './appleSubscriptions.js';
import { appleListingSource } from './appleListing.js';
import { appleCapabilitiesSource } from './appleCapabilities.js';
import { playProductsSource } from './playProducts.js';
import { playSubscriptionsSource } from './playSubscriptions.js';
import { makeAscCatalogApiFake } from '../../ascCatalogApi.testkit.js';
import type {
  AppDescriptor,
  AppEntities,
  LaunchConfig,
  PlayCatalogApi,
  RestoreContext,
  RestoreInput,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotPlayApi,
} from '../../types.js';

const CONFIG: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
};

function app(over: Partial<AppDescriptor>): AppDescriptor {
  return { name: 'alpha', dir: '/tmp/alpha', configPath: '/tmp/alpha/app.json', ...over };
}

function ctx(over: Partial<SnapshotContext>): SnapshotContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
    ...over,
  };
}

const ascApi: SnapshotAscApi = {
  getAppId: () => Promise.resolve('1234567890'),
  listInAppPurchases: () =>
    Promise.resolve([
      { productId: 'com.acme.coins', inAppPurchaseType: 'CONSUMABLE', state: 'APPROVED' },
    ]),
  listSubscriptionGroups: () => Promise.resolve([{ id: 'g1', referenceName: 'Pro' }]),
  listSubscriptions: () =>
    Promise.resolve([{ productId: 'com.acme.pro', subscriptionPeriod: 'P1M', state: 'APPROVED' }]),
  getEditableAppInfoId: () => Promise.resolve('appinfo-1'),
  listAppInfoLocalizations: () =>
    Promise.resolve([
      { id: 'ail-1', locale: 'en-US', fields: { name: 'Acme', subtitle: 'Do more' } },
    ]),
  getEditableVersionId: () => Promise.resolve('ver-1'),
  listVersionLocalizations: () =>
    Promise.resolve([
      {
        id: 'avl-1',
        locale: 'en-US',
        fields: { description: 'Great app', keywords: 'acme,tools' },
      },
    ]),
  findBundleId: () => Promise.resolve({ id: 'bundle-1', identifier: 'com.acme.alpha' }),
  listBundleIdCapabilities: () =>
    Promise.resolve([{ capabilityType: 'PUSH_NOTIFICATIONS' }, { capabilityType: 'ICLOUD' }]),
};

const playApi: SnapshotPlayApi = {
  listInAppProducts: () =>
    Promise.resolve([
      {
        sku: 'coins',
        status: 'active',
        defaultLanguage: 'en-US',
        defaultPrice: { priceMicros: '990000', currency: 'USD' },
        listings: { 'en-US': { title: 'Coins', description: 'A pile of coins' } },
      },
    ]),
  listSubscriptions: () =>
    Promise.resolve([
      {
        productId: 'sub.pro',
        basePlans: [
          {
            basePlanId: 'monthly',
            state: 'ACTIVE',
            autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' },
            regionalConfigs: [
              {
                regionCode: 'US',
                newSubscriberAvailability: true,
                price: { currencyCode: 'USD', units: '4', nanos: 990000000 },
              },
            ],
          },
        ],
        listings: [{ languageCode: 'en-US', title: 'Pro', description: 'Pro plan' }],
      },
    ]),
};

describe('appleProductsSource', () => {
  it('omits when no iOS apps are in scope', async () => {
    const capture = await appleProductsSource.capture(
      ctx({ apps: [app({ packageName: 'com.acme.alpha' })] }),
    );
    expect(capture).toEqual({ state: 'omitted' });
  });

  it('skips when no Apple account is active', async () => {
    const capture = await appleProductsSource.capture(
      ctx({ apps: [app({ bundleId: 'com.acme.alpha' })] }),
    );
    expect(capture.state).toBe('skipped');
  });

  it('captures each in-app purchase keyed by product id', async () => {
    const capture = await appleProductsSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve(ascApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'com.acme.coins',
        summary: 'in-app purchase CONSUMABLE (APPROVED)',
        data: { productId: 'com.acme.coins', type: 'CONSUMABLE', state: 'APPROVED' },
      },
    ]);
  });

  it('drops an app with no App Store Connect record yet', async () => {
    const capture = await appleProductsSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve({ ...ascApi, getAppId: () => Promise.resolve(null) }),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps).toEqual([]);
  });
});

describe('appleSubscriptionsSource', () => {
  it('flattens subscriptions across groups, keyed by product id with the group recorded', async () => {
    const capture = await appleSubscriptionsSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve(ascApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'com.acme.pro',
        summary: 'subscription P1M in Pro (APPROVED)',
        data: { productId: 'com.acme.pro', group: 'Pro', period: 'P1M', state: 'APPROVED' },
      },
    ]);
  });
});

describe('appleListingSource', () => {
  it('merges app-info and version listing fields into one entity per locale', async () => {
    const capture = await appleListingSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve(ascApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'en-US',
        summary: 'listing en-US (4 field(s))',
        data: {
          locale: 'en-US',
          fields: {
            name: 'Acme',
            subtitle: 'Do more',
            description: 'Great app',
            keywords: 'acme,tools',
          },
        },
      },
    ]);
  });

  it('captures an empty listing when nothing is editable', async () => {
    const capture = await appleListingSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () =>
          Promise.resolve({
            ...ascApi,
            getEditableAppInfoId: () => Promise.resolve(null),
            getEditableVersionId: () => Promise.resolve(null),
          }),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([]);
  });

  it('drops an app with no App Store Connect record yet', async () => {
    const capture = await appleListingSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve({ ...ascApi, getAppId: () => Promise.resolve(null) }),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps).toEqual([]);
  });
});

describe('playProductsSource', () => {
  it('skips when no Play service account is configured', async () => {
    const capture = await playProductsSource.capture(
      ctx({ apps: [app({ packageName: 'com.acme.alpha' })] }),
    );
    expect(capture.state).toBe('skipped');
  });

  it('captures managed products keyed by SKU, dropping the fanned-out region prices', async () => {
    const capture = await playProductsSource.capture(
      ctx({
        apps: [app({ packageName: 'com.acme.alpha' })],
        resolvePlayApi: () => Promise.resolve(playApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'coins',
        summary: 'Play product (active)',
        data: {
          sku: 'coins',
          status: 'active',
          defaultLanguage: 'en-US',
          defaultPrice: { priceMicros: '990000', currency: 'USD' },
          listings: { 'en-US': { title: 'Coins', description: 'A pile of coins' } },
        },
      },
    ]);
  });
});

describe('playSubscriptionsSource', () => {
  it('captures subscriptions with base plans and listings, keyed by product id', async () => {
    const capture = await playSubscriptionsSource.capture(
      ctx({
        apps: [app({ packageName: 'com.acme.alpha' })],
        resolvePlayApi: () => Promise.resolve(playApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'sub.pro',
        summary: 'Play subscription (1 base plan(s))',
        data: {
          productId: 'sub.pro',
          basePlans: [
            {
              basePlanId: 'monthly',
              state: 'ACTIVE',
              period: 'P1M',
              prices: { US: { priceMicros: '4990000', currency: 'USD' } },
            },
          ],
          listings: [{ languageCode: 'en-US', title: 'Pro' }],
        },
      },
    ]);
  });
});

describe('appleCapabilitiesSource', () => {
  it('omits when no iOS apps are in scope', async () => {
    const capture = await appleCapabilitiesSource.capture(
      ctx({ apps: [app({ packageName: 'com.acme.alpha' })] }),
    );
    expect(capture).toEqual({ state: 'omitted' });
  });

  it('skips when no Apple account is active', async () => {
    const capture = await appleCapabilitiesSource.capture(
      ctx({ apps: [app({ bundleId: 'com.acme.alpha' })] }),
    );
    expect(capture.state).toBe('skipped');
  });

  it('captures enabled capabilities keyed and sorted by capability type', async () => {
    const capture = await appleCapabilitiesSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () => Promise.resolve(ascApi),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([
      { key: 'ICLOUD', summary: 'capability ICLOUD', data: { capabilityType: 'ICLOUD' } },
      {
        key: 'PUSH_NOTIFICATIONS',
        summary: 'capability PUSH_NOTIFICATIONS',
        data: { capabilityType: 'PUSH_NOTIFICATIONS' },
      },
    ]);
  });

  it("captures an empty list when the App ID isn't registered yet", async () => {
    const capture = await appleCapabilitiesSource.capture(
      ctx({
        apps: [app({ bundleId: 'com.acme.alpha' })],
        resolveAscApi: () =>
          Promise.resolve({ ...ascApi, findBundleId: () => Promise.resolve(null) }),
      }),
    );
    if (capture.state !== 'captured') throw new Error(`expected captured, got ${capture.state}`);
    expect(capture.apps[0]?.entities).toEqual([]);
  });
});

describe('appleListingSource.restore', () => {
  /** One app's captured listing, keyed by locale, with both app-level and version-level fields. */
  const saved: AppEntities[] = [
    {
      app: 'alpha',
      identifier: 'com.acme.alpha',
      entities: [
        {
          key: 'en-US',
          summary: 'listing en-US',
          data: {
            locale: 'en-US',
            fields: {
              name: 'Acme',
              subtitle: 'Do more',
              description: 'Great app',
              keywords: 'acme,tools',
              whatsNew: 'Bug fixes',
            },
          },
        },
      ],
    },
  ];

  /** Narrow the optional `restore` to a callable, failing the test if the source ever drops it. */
  function restoreOf(): NonNullable<typeof appleListingSource.restore> {
    const restore = appleListingSource.restore;
    if (!restore) throw new Error('expected appleListingSource to implement restore');
    return restore;
  }

  function input(over: Partial<RestoreInput>): RestoreInput {
    return {
      ctx: {
        config: CONFIG,
        apps: [],
        resolveAscWriteClient: () => Promise.resolve(null),
        resolvePlayWriteClient: () => Promise.resolve(null),
      },
      saved,
      dryRun: true,
      ...over,
    };
  }

  it('skips with no writes when no Apple account is active', async () => {
    const report = await restoreOf()(input({}));
    expect(report.actions).toEqual([
      {
        description: 'App Store listing: skipped — no active Apple account',
        destructive: false,
        status: 'skipped',
      },
    ]);
  });

  it('plans the routed listing fields in a dry-run without writing', async () => {
    const api = makeAscCatalogApiFake();
    const report = await restoreOf()(
      input({
        ctx: {
          config: CONFIG,
          apps: [],
          resolveAscWriteClient: () => Promise.resolve(api),
          resolvePlayWriteClient: () => Promise.resolve(null),
        },
      }),
    );
    const descriptions = report.actions.map((action) => action.description);
    expect(descriptions.some((line) => line.includes('App Info') && line.includes('name'))).toBe(
      true,
    );
    expect(
      descriptions.some(
        (line) => line.includes('App Store version') && line.includes('description'),
      ),
    ).toBe(true);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(api.createAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.createVersionLocalization).toHaveBeenCalledTimes(0);
  });

  it('applies the inverted listing, round-tripping keywords back to a comma string', async () => {
    const api = makeAscCatalogApiFake();
    const report = await restoreOf()(
      input({
        dryRun: false,
        ctx: {
          config: CONFIG,
          apps: [],
          resolveAscWriteClient: () => Promise.resolve(api),
          resolvePlayWriteClient: () => Promise.resolve(null),
        },
      }),
    );
    expect(api.createAppInfoLocalization).toHaveBeenCalledWith(
      'appinfo1',
      'en-US',
      expect.objectContaining({ name: 'Acme', subtitle: 'Do more' }),
    );
    expect(api.createVersionLocalization).toHaveBeenCalledWith(
      'version1',
      'en-US',
      expect.objectContaining({
        description: 'Great app',
        keywords: 'acme,tools',
        whatsNew: 'Bug fixes',
      }),
    );
    expect(report.actions.every((action) => action.status === 'applied')).toBe(true);
  });
});

/** A fully-stubbed {@link PlayCatalogApi}. Reads default to "nothing exists yet"; writes resolve. */
function makePlayApi(overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi {
  const base: PlayCatalogApi = {
    assertAppExists: vi.fn().mockResolvedValue(undefined),
    listInAppProducts: vi.fn().mockResolvedValue([]),
    insertInAppProduct: vi.fn().mockResolvedValue(undefined),
    updateInAppProduct: vi.fn().mockResolvedValue(undefined),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    createSubscription: vi.fn().mockResolvedValue(undefined),
    patchSubscription: vi.fn().mockResolvedValue(undefined),
    activateBasePlan: vi.fn().mockResolvedValue(undefined),
    listSubscriptionOffers: vi.fn().mockResolvedValue([]),
    createSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
    activateSubscriptionOffer: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

/** A restore context defaulting both write resolvers to "no account"; override the one under test. */
function restoreCtx(over: Partial<RestoreContext> = {}): RestoreContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscWriteClient: () => Promise.resolve(null),
    resolvePlayWriteClient: () => Promise.resolve(null),
    ...over,
  };
}

describe('playProductsSource.restore', () => {
  /** One app's captured managed product — the same shape `playProductsSource.capture` records. */
  const savedProducts: AppEntities[] = [
    {
      app: 'alpha',
      identifier: 'com.acme.alpha',
      entities: [
        {
          key: 'coins',
          summary: 'Play product (active)',
          data: {
            sku: 'coins',
            status: 'active',
            defaultLanguage: 'en-US',
            defaultPrice: { priceMicros: '990000', currency: 'USD' },
            listings: { 'en-US': { title: 'Coins', description: 'A pile of coins' } },
          },
        },
      ],
    },
  ];

  /** Narrow the optional `restore` to a callable, failing the test if the source ever drops it. */
  function restoreOf(): NonNullable<typeof playProductsSource.restore> {
    const restore = playProductsSource.restore;
    if (!restore) throw new Error('expected playProductsSource to implement restore');
    return restore;
  }

  function input(over: Partial<RestoreInput>): RestoreInput {
    return { ctx: restoreCtx(), saved: savedProducts, dryRun: true, ...over };
  }

  it('skips with no writes when no Play service account is configured', async () => {
    const report = await restoreOf()(input({}));
    expect(report.actions).toEqual([
      {
        description: 'Google Play products: skipped — no Play service account',
        destructive: false,
        status: 'skipped',
      },
    ]);
  });

  it('plans a create in a dry-run without inserting', async () => {
    const api = makePlayApi();
    const report = await restoreOf()(
      input({ ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }) }),
    );
    expect(report.actions).toEqual([
      { description: 'create Play product coins', destructive: false, status: 'planned' },
    ]);
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
  });

  it('applies a create, inverting the captured listing and default price', async () => {
    const api = makePlayApi();
    const report = await restoreOf()(
      input({
        dryRun: false,
        ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }),
      }),
    );
    expect(api.insertInAppProduct).toHaveBeenCalledWith(
      'com.acme.alpha',
      expect.objectContaining({
        sku: 'coins',
        defaultLanguage: 'en-US',
        defaultPrice: { priceMicros: '990000', currency: 'USD' },
      }),
    );
    expect(report.actions.every((action) => action.status === 'applied')).toBe(true);
  });

  it('skips a product with no captured listing', async () => {
    const api = makePlayApi();
    const report = await restoreOf()(
      input({
        ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }),
        saved: [
          {
            app: 'alpha',
            identifier: 'com.acme.alpha',
            entities: [{ key: 'coins', summary: '', data: { sku: 'coins' } }],
          },
        ],
      }),
    );
    expect(report.actions).toEqual([
      {
        description: 'Play product coins: skipped — no listing to restore',
        destructive: false,
        status: 'skipped',
      },
    ]);
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
  });
});

describe('playSubscriptionsSource.restore', () => {
  /** One app's captured subscription — the same shape `playSubscriptionsSource.capture` records. */
  const savedSubs: AppEntities[] = [
    {
      app: 'alpha',
      identifier: 'com.acme.alpha',
      entities: [
        {
          key: 'sub.pro',
          summary: 'Play subscription (1 base plan(s))',
          data: {
            productId: 'sub.pro',
            basePlans: [
              {
                basePlanId: 'monthly',
                state: 'ACTIVE',
                period: 'P1M',
                prices: { US: { priceMicros: '4990000', currency: 'USD' } },
              },
            ],
            listings: [{ languageCode: 'en-US', title: 'Pro' }],
          },
        },
      ],
    },
  ];

  /** Narrow the optional `restore` to a callable, failing the test if the source ever drops it. */
  function restoreOf(): NonNullable<typeof playSubscriptionsSource.restore> {
    const restore = playSubscriptionsSource.restore;
    if (!restore) throw new Error('expected playSubscriptionsSource to implement restore');
    return restore;
  }

  function input(over: Partial<RestoreInput>): RestoreInput {
    return { ctx: restoreCtx(), saved: savedSubs, dryRun: true, ...over };
  }

  it('skips with no writes when no Play service account is configured', async () => {
    const report = await restoreOf()(input({}));
    expect(report.actions).toEqual([
      {
        description: 'Google Play subscriptions: skipped — no Play service account',
        destructive: false,
        status: 'skipped',
      },
    ]);
  });

  it('plans the create + base-plan activation in a dry-run without writing', async () => {
    const api = makePlayApi();
    const report = await restoreOf()(
      input({ ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }) }),
    );
    const descriptions = report.actions.map((action) => action.description);
    expect(descriptions).toEqual([
      'create Play subscription sub.pro',
      'activate base plan monthly',
    ]);
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
  });

  it("applies the create, inverting the base plan's period and prices", async () => {
    const api = makePlayApi();
    await restoreOf()(
      input({
        dryRun: false,
        ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }),
      }),
    );
    expect(api.createSubscription).toHaveBeenCalledWith(
      'com.acme.alpha',
      expect.objectContaining({ productId: 'sub.pro' }),
    );
    expect(api.activateBasePlan).toHaveBeenCalledWith('com.acme.alpha', 'sub.pro', 'monthly');
  });

  it('skips a subscription whose base plan has no known period or prices', async () => {
    const api = makePlayApi();
    const report = await restoreOf()(
      input({
        ctx: restoreCtx({ resolvePlayWriteClient: () => Promise.resolve(api) }),
        saved: [
          {
            app: 'alpha',
            identifier: 'com.acme.alpha',
            entities: [
              {
                key: 'sub.pro',
                summary: '',
                data: { productId: 'sub.pro', basePlans: [{ basePlanId: 'monthly' }] },
              },
            ],
          },
        ],
      }),
    );
    expect(report.actions).toEqual([
      {
        description:
          'Play subscription sub.pro: skipped — needs a base plan with a known period and prices',
        destructive: false,
        status: 'skipped',
      },
    ]);
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
  });
});
