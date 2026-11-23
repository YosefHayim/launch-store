import { describe, expect, it, vi } from 'vitest';
import { appleProductsSource } from './apple-products.ts';
import { appleSubscriptionsSource } from './apple-subscriptions.ts';
import { appleListingSource } from './apple-listing.ts';
import { appleCapabilitiesSource } from './apple-capabilities.ts';
import { playProductsSource } from './play-products.ts';
import { playSubscriptionsSource } from './play-subscriptions.ts';
import { makeAscCatalogApiFake } from '@/testkit/asc-catalog-api-testkit.js';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type { PlayCatalogApi } from '@/types/plan.js';
import type {
  AppEntities,
  RestoreContext,
  RestoreInput,
  SnapshotAscApi,
  SnapshotContext,
  SnapshotPlayApi,
  SnapshotSource,
} from '@/types/snapshot.js';
import type { ActionStatus } from '@/types/reconcile.js';
import type { SnapshotEntity } from '@/types/snapshot.js';

const CONFIG: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};
function app(over: Partial<AppDescriptor>): AppDescriptor {
  return { name: 'alpha', dir: '/tmp/alpha', configPath: '/tmp/alpha/app.json', ...over };
}
function snapshotContext(over: Partial<SnapshotContext>): SnapshotContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscApi() {
      return Promise.resolve(null);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
    ...over,
  };
}
function captureSource(source: SnapshotSource, snapshotContext: SnapshotContext) {
  return source.capture(snapshotContext);
}

function runRestore(restore: NonNullable<SnapshotSource['restore']>, restoreInput: RestoreInput) {
  return restore(restoreInput);
}
const ascApi: SnapshotAscApi = {
  getAppId() {
    return Promise.resolve('1234567890');
  },
  listInAppPurchases() {
    return Promise.resolve([
      { productId: 'com.acme.coins', inAppPurchaseType: 'CONSUMABLE', state: 'APPROVED' },
    ]);
  },
  listSubscriptionGroups() {
    return Promise.resolve([{ id: 'g1', referenceName: 'Pro' }]);
  },
  listSubscriptions() {
    return Promise.resolve([
      { productId: 'com.acme.pro', subscriptionPeriod: 'P1M', state: 'APPROVED' },
    ]);
  },
  getCurrentAppInfoId() {
    return Promise.resolve('appinfo-1');
  },
  listAppInfoLocalizations() {
    return Promise.resolve([
      { id: 'ail-1', locale: 'en-US', fields: { name: 'Acme', subtitle: 'Do more' } },
    ]);
  },
  getCurrentVersionId() {
    return Promise.resolve('ver-1');
  },
  listVersionLocalizations() {
    return Promise.resolve([
      {
        id: 'avl-1',
        locale: 'en-US',
        fields: { description: 'Great app', keywords: 'acme,tools' },
      },
    ]);
  },
  findBundleId() {
    return Promise.resolve({ id: 'bundle-1', identifier: 'com.acme.alpha' });
  },
  listBundleIdCapabilities() {
    return Promise.resolve([
      { capabilityType: 'PUSH_NOTIFICATIONS' },
      { capabilityType: 'ICLOUD' },
    ]);
  },
};
const playApi: SnapshotPlayApi = {
  listInAppProducts() {
    return Promise.resolve([
      {
        sku: 'coins',
        status: 'active',
        defaultLanguage: 'en-US',
        defaultPrice: { priceMicros: '990000', currency: 'USD' },
        listings: { 'en-US': { title: 'Coins', description: 'A pile of coins' } },
      },
    ]);
  },
  listSubscriptions() {
    return Promise.resolve([
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
    ]);
  },
};
function describeAppleProductsPiece() {
  async function omitsWhenNoIOSAppsAreInScope() {
    const snapshot = snapshotContext({ apps: [app({ packageName: 'com.acme.alpha' })] });
    const capture = await captureSource(appleProductsSource, snapshot);
    expect(capture).toEqual({ state: 'omitted' });
  }

  it('omits when no iOS apps are in scope', omitsWhenNoIOSAppsAreInScope);

  async function skipsWhenNoAppleAccountIsActive() {
    const snapshot = snapshotContext({ apps: [app({ bundleId: 'com.acme.alpha' })] });
    const capture = await captureSource(appleProductsSource, snapshot);
    expect(capture.state).toBe('skipped');
  }

  it('skips when no Apple account is active', skipsWhenNoAppleAccountIsActive);

  async function capturesEachInAppPurchaseKeyedByProductId() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve(ascApi);
      },
    });
    const capture = await captureSource(appleProductsSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'com.acme.coins',
        summary: 'in-app purchase CONSUMABLE (APPROVED)',
        data: { productId: 'com.acme.coins', type: 'CONSUMABLE', state: 'APPROVED' },
      },
    ]);
  }

  it(
    'captures each in-app purchase keyed by product id',
    capturesEachInAppPurchaseKeyedByProductId,
  );

  async function dropsAnAppWithNoAppStoreConnectPieceYet() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve({
          ...ascApi,
          getAppId() {
            return Promise.resolve(null);
          },
        });
      },
    });
    const capture = await captureSource(appleProductsSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps).toEqual([]);
  }

  it('drops an app with no App Store Connect record yet', dropsAnAppWithNoAppStoreConnectPieceYet);
}

describe('appleProductsSource', describeAppleProductsPiece);
function describeAppleSubscriptionsPiece() {
  async function flattensSubscriptionsAcrossGroupsKeyedByProductIdWithTheGroupRecorded() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve(ascApi);
      },
    });
    const capture = await captureSource(appleSubscriptionsSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps[0]?.entities).toEqual([
      {
        key: 'com.acme.pro',
        summary: 'subscription P1M in Pro (APPROVED)',
        data: { productId: 'com.acme.pro', group: 'Pro', period: 'P1M', state: 'APPROVED' },
      },
    ]);
  }

  it(
    'flattens subscriptions across groups, keyed by product id with the group recorded',
    flattensSubscriptionsAcrossGroupsKeyedByProductIdWithTheGroupRecorded,
  );
}

describe('appleSubscriptionsSource', describeAppleSubscriptionsPiece);
function describeAppleListingPiece() {
  async function mergesAppPieceAndVersionListingFieldsIntoOneEntityPerLocale() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve(ascApi);
      },
    });
    const capture = await captureSource(appleListingSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

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
  }

  it(
    'merges app-info and version listing fields into one entity per locale',
    mergesAppPieceAndVersionListingFieldsIntoOneEntityPerLocale,
  );

  async function capturesAnEmptyListingWhenTheAppHasNoListingYet() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve({
          ...ascApi,
          getCurrentAppInfoId() {
            return Promise.resolve(null);
          },
          getCurrentVersionId() {
            return Promise.resolve(null);
          },
        });
      },
    });
    const capture = await captureSource(appleListingSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps[0]?.entities).toEqual([]);
  }

  it(
    'captures an empty listing when the app has no listing yet',
    capturesAnEmptyListingWhenTheAppHasNoListingYet,
  );

  async function dropsAnAppWithNoAppStoreConnectPieceYet2() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve({
          ...ascApi,
          getAppId() {
            return Promise.resolve(null);
          },
        });
      },
    });
    const capture = await captureSource(appleListingSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps).toEqual([]);
  }

  it('drops an app with no App Store Connect record yet', dropsAnAppWithNoAppStoreConnectPieceYet2);
}

describe('appleListingSource', describeAppleListingPiece);
function describePlayProductsPiece() {
  async function skipsWhenNoPlayServiceAccountIsConfigured() {
    const snapshot = snapshotContext({ apps: [app({ packageName: 'com.acme.alpha' })] });
    const capture = await captureSource(playProductsSource, snapshot);
    expect(capture.state).toBe('skipped');
  }

  it('skips when no Play service account is configured', skipsWhenNoPlayServiceAccountIsConfigured);

  async function capturesManagedProductsKeyedBySKUDroppingTheFannedOutRegionPrices() {
    const snapshot = snapshotContext({
      apps: [app({ packageName: 'com.acme.alpha' })],
      resolvePlayApi() {
        return Promise.resolve(playApi);
      },
    });
    const capture = await captureSource(playProductsSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

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
  }

  it(
    'captures managed products keyed by SKU, dropping the fanned-out region prices',
    capturesManagedProductsKeyedBySKUDroppingTheFannedOutRegionPrices,
  );
}

describe('playProductsSource', describePlayProductsPiece);
function describePlaySubscriptionsPiece() {
  async function capturesSubscriptionsWithBasePlansAndListingsKeyedByProductId() {
    const snapshot = snapshotContext({
      apps: [app({ packageName: 'com.acme.alpha' })],
      resolvePlayApi() {
        return Promise.resolve(playApi);
      },
    });
    const capture = await captureSource(playSubscriptionsSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

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
  }

  it(
    'captures subscriptions with base plans and listings, keyed by product id',
    capturesSubscriptionsWithBasePlansAndListingsKeyedByProductId,
  );
}

describe('playSubscriptionsSource', describePlaySubscriptionsPiece);
function describeAppleCapabilitiesPiece() {
  async function omitsWhenNoIOSAppsAreInScope2() {
    const snapshot = snapshotContext({ apps: [app({ packageName: 'com.acme.alpha' })] });
    const capture = await captureSource(appleCapabilitiesSource, snapshot);
    expect(capture).toEqual({ state: 'omitted' });
  }

  it('omits when no iOS apps are in scope', omitsWhenNoIOSAppsAreInScope2);

  async function skipsWhenNoAppleAccountIsActive2() {
    const snapshot = snapshotContext({ apps: [app({ bundleId: 'com.acme.alpha' })] });
    const capture = await captureSource(appleCapabilitiesSource, snapshot);
    expect(capture.state).toBe('skipped');
  }

  it('skips when no Apple account is active', skipsWhenNoAppleAccountIsActive2);

  async function capturesEnabledCapabilitiesKeyedAndSortedByCapabilityType() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve(ascApi);
      },
    });
    const capture = await captureSource(appleCapabilitiesSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps[0]?.entities).toEqual([
      { key: 'ICLOUD', summary: 'capability ICLOUD', data: { capabilityType: 'ICLOUD' } },
      {
        key: 'PUSH_NOTIFICATIONS',
        summary: 'capability PUSH_NOTIFICATIONS',
        data: { capabilityType: 'PUSH_NOTIFICATIONS' },
      },
    ]);
  }

  it(
    'captures enabled capabilities keyed and sorted by capability type',
    capturesEnabledCapabilitiesKeyedAndSortedByCapabilityType,
  );

  async function capturesAnEmptyListWhenTheAppIDIsnTRegisteredYet() {
    const snapshot = snapshotContext({
      apps: [app({ bundleId: 'com.acme.alpha' })],
      resolveAscApi() {
        return Promise.resolve({
          ...ascApi,
          findBundleId() {
            return Promise.resolve(null);
          },
        });
      },
    });
    const capture = await captureSource(appleCapabilitiesSource, snapshot);

    if (capture.state != 'captured') throw new Error(`expected captured, got ${capture.state}`);

    expect(capture.apps[0]?.entities).toEqual([]);
  }

  it(
    "captures an empty list when the App ID isn't registered yet",
    capturesAnEmptyListWhenTheAppIDIsnTRegisteredYet,
  );
}

describe('appleCapabilitiesSource', describeAppleCapabilitiesPiece);
function describeAppleListingPieceRestore() {
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
        resolveAscWriteClient() {
          return Promise.resolve(null);
        },
        resolvePlayWriteClient() {
          return Promise.resolve(null);
        },
      },
      saved,
      dryRun: true,
      ...over,
    };
  }
  async function skipsWithNoWritesWhenNoAppleAccountIsActive() {
    const report = await runRestore(restoreOf(), input({}));

    expect(report.actions).toEqual([
      {
        description: 'App Store listing: skipped - no active Apple account',
        destructive: false,
        status: 'skipped',
      },
    ]);
  }

  it(
    'skips with no writes when no Apple account is active',
    skipsWithNoWritesWhenNoAppleAccountIsActive,
  );

  async function plansTheRoutedListingFieldsInADryRunWithoutWriting() {
    const api = makeAscCatalogApiFake();
    const report = await runRestore(
      restoreOf(),
      input({
        ctx: {
          config: CONFIG,
          apps: [],
          resolveAscWriteClient() {
            return Promise.resolve(api);
          },
          resolvePlayWriteClient() {
            return Promise.resolve(null);
          },
        },
      }),
    );

    function readDescription(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    const descriptions = report.actions.map(readDescription);

    function includesListingName(line: string) {
      return line.includes('App Info') && line.includes('name');
    }

    expect(descriptions.some(includesListingName)).toBe(true);

    function includesVersionDescription(line: string) {
      return line.includes('App Store version') && line.includes('description');
    }

    expect(descriptions.some(includesVersionDescription)).toBe(true);

    function isPlannedStep(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(isPlannedStep)).toBe(true);
    expect(api.createAppInfoLocalization).toHaveBeenCalledTimes(0);
    expect(api.createVersionLocalization).toHaveBeenCalledTimes(0);
  }

  it(
    'plans the routed listing fields in a dry-run without writing',
    plansTheRoutedListingFieldsInADryRunWithoutWriting,
  );

  async function appliesTheInvertedListingRoundTrippingKeywordsBackToACommaString() {
    const api = makeAscCatalogApiFake();
    const report = await runRestore(
      restoreOf(),
      input({
        dryRun: false,
        ctx: {
          config: CONFIG,
          apps: [],
          resolveAscWriteClient() {
            return Promise.resolve(api);
          },
          resolvePlayWriteClient() {
            return Promise.resolve(null);
          },
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

    function isAppliedStep(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'applied';
    }

    expect(report.actions.every(isAppliedStep)).toBe(true);
  }

  it(
    'applies the inverted listing, round-tripping keywords back to a comma string',
    appliesTheInvertedListingRoundTrippingKeywordsBackToACommaString,
  );
}

describe('appleListingSource.restore', describeAppleListingPieceRestore);
/** A fully-stubbed {@link PlayCatalogApi}. Reads default to "nothing exists yet"; writes resolve. */
function makePlayApi(overrides: Partial<PlayCatalogApi> = {}): PlayCatalogApi {
  function mockCall() {
    return Promise.resolve();
  }

  function mockCall2() {
    return Promise.resolve([]);
  }

  function mockCall3() {
    return Promise.resolve();
  }

  function mockCall4() {
    return Promise.resolve();
  }

  function mockCall5() {
    return Promise.resolve([]);
  }

  function mockCall6() {
    return Promise.resolve();
  }

  function mockCall7() {
    return Promise.resolve();
  }

  function mockCall8() {
    return Promise.resolve();
  }

  function mockCall9() {
    return Promise.resolve([]);
  }

  function mockCall10() {
    return Promise.resolve();
  }

  function mockCall11() {
    return Promise.resolve();
  }

  const base: PlayCatalogApi = {
    assertAppExists: vi.fn(mockCall),
    listInAppProducts: vi.fn(mockCall2),
    insertInAppProduct: vi.fn(mockCall3),
    updateInAppProduct: vi.fn(mockCall4),
    listSubscriptions: vi.fn(mockCall5),
    createSubscription: vi.fn(mockCall6),
    patchSubscription: vi.fn(mockCall7),
    activateBasePlan: vi.fn(mockCall8),
    listSubscriptionOffers: vi.fn(mockCall9),
    createSubscriptionOffer: vi.fn(mockCall10),
    activateSubscriptionOffer: vi.fn(mockCall11),
  };

  return { ...base, ...overrides };
}
/** A restore context defaulting both write resolvers to "no account"; override the one under test. */
function restoreCtx(over: Partial<RestoreContext> = {}): RestoreContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscWriteClient() {
      return Promise.resolve(null);
    },
    resolvePlayWriteClient() {
      return Promise.resolve(null);
    },
    ...over,
  };
}
function describePlayProductsPieceRestore() {
  /** One app's captured managed product - the same shape `playProductsSource.capture` records. */
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
  async function skipsWithNoWritesWhenNoPlayServiceAccountIsConfigured() {
    const report = await runRestore(restoreOf(), input({}));

    expect(report.actions).toEqual([
      {
        description: 'Google Play: skipped - no Play service account for com.acme.alpha',
        destructive: false,
        status: 'skipped',
      },
    ]);
  }

  it(
    'skips with no writes when no Play service account is configured',
    skipsWithNoWritesWhenNoPlayServiceAccountIsConfigured,
  );

  async function plansACreateInADryRunWithoutInserting() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });
    const report = await runRestore(restoreOf(), input({ ctx: restore }));

    expect(report.actions).toEqual([
      { description: 'create Play product coins', destructive: false, status: 'planned' },
    ]);
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
  }

  it('plans a create in a dry-run without inserting', plansACreateInADryRunWithoutInserting);

  async function appliesACreateInvertingTheCapturedListingAndDefaultPrice() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });
    const report = await runRestore(
      restoreOf(),
      input({
        dryRun: false,
        ctx: restore,
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

    function isAppliedCreate(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'applied';
    }

    expect(report.actions.every(isAppliedCreate)).toBe(true);
  }

  it(
    'applies a create, inverting the captured listing and default price',
    appliesACreateInvertingTheCapturedListingAndDefaultPrice,
  );

  async function skipsAProductWithNoCapturedListing() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });
    const report = await runRestore(
      restoreOf(),
      input({
        ctx: restore,
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
        description: 'Play product coins: skipped - no listing to restore',
        destructive: false,
        status: 'skipped',
      },
    ]);
    expect(api.insertInAppProduct).toHaveBeenCalledTimes(0);
  }

  it('skips a product with no captured listing', skipsAProductWithNoCapturedListing);
}

describe('playProductsSource.restore', describePlayProductsPieceRestore);
function describePlaySubscriptionsPieceRestore() {
  /** One app's captured subscription - the same shape `playSubscriptionsSource.capture` records. */
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
  async function skipsWithNoWritesWhenNoPlayServiceAccountIsConfigured2() {
    const report = await runRestore(restoreOf(), input({}));

    expect(report.actions).toEqual([
      {
        description: 'Google Play: skipped - no Play service account for com.acme.alpha',
        destructive: false,
        status: 'skipped',
      },
    ]);
  }

  it(
    'skips with no writes when no Play service account is configured',
    skipsWithNoWritesWhenNoPlayServiceAccountIsConfigured2,
  );

  async function plansTheCreateBasePlanActivationInADryRunWithoutWriting() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });
    const report = await runRestore(restoreOf(), input({ ctx: restore }));

    function readDescription2(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.description;
    }

    const descriptions = report.actions.map(readDescription2);

    expect(descriptions).toEqual([
      'create Play subscription sub.pro',
      'activate base plan monthly',
    ]);

    function isPlannedCreate(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(isPlannedCreate)).toBe(true);
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
  }

  it(
    'plans the create + base-plan activation in a dry-run without writing',
    plansTheCreateBasePlanActivationInADryRunWithoutWriting,
  );

  async function appliesTheCreateInvertingTheBasePlanSPeriodAndPrices() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });

    await runRestore(
      restoreOf(),
      input({
        dryRun: false,
        ctx: restore,
      }),
    );
    expect(api.createSubscription).toHaveBeenCalledWith(
      'com.acme.alpha',
      expect.objectContaining({ productId: 'sub.pro' }),
    );
    expect(api.activateBasePlan).toHaveBeenCalledWith('com.acme.alpha', 'sub.pro', 'monthly');
  }

  it(
    "applies the create, inverting the base plan's period and prices",
    appliesTheCreateInvertingTheBasePlanSPeriodAndPrices,
  );

  async function skipsASubscriptionWhoseBasePlanHasNoKnownPeriodOrPrices() {
    const api = makePlayApi();
    const restore = restoreCtx({
      resolvePlayWriteClient() {
        return Promise.resolve(api);
      },
    });
    const report = await runRestore(
      restoreOf(),
      input({
        ctx: restore,
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
          'Play subscription sub.pro: skipped - needs a base plan with a known period and prices',
        destructive: false,
        status: 'skipped',
      },
    ]);
    expect(api.createSubscription).toHaveBeenCalledTimes(0);
  }

  it(
    'skips a subscription whose base plan has no known period or prices',
    skipsASubscriptionWhoseBasePlanHasNoKnownPeriodOrPrices,
  );
}

describe('playSubscriptionsSource.restore', describePlaySubscriptionsPieceRestore);
function describeMixedAndroidSnapshotCapture() {
  for (const source of [playProductsSource, playSubscriptionsSource]) {
    async function itPiece() {
      const snapshot = snapshotContext({
        apps: [
          app({ name: 'alpha', packageName: 'com.acme.alpha' }),
          app({ name: 'beta', packageName: 'com.acme.beta' }),
        ],
        resolvePlayApi(packageName) {
          return Promise.resolve(packageName == 'com.acme.alpha' ? playApi : null);
        },
      });
      const capture = await captureSource(source, snapshot);

      if (capture.state != 'captured')
        throw new Error(`Expected partial capture: ${capture.state}`);

      function readApp(item: {
        readonly app: string;
        readonly identifier: string;
        readonly entities: readonly SnapshotEntity[];
      }) {
        return item.app;
      }

      expect(capture.apps.map(readApp)).toEqual(['alpha']);
      expect(capture.skippedApps).toEqual([
        { app: 'beta', identifier: 'com.acme.beta', reason: 'no Play service account' },
      ]);
    }

    it(`${source.id} retains the reachable app and records the missing one`, itPiece);
  }
}

describe('mixed Android snapshot capture', describeMixedAndroidSnapshotCapture);
