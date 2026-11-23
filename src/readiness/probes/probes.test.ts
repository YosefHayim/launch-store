import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { agreementsProbe } from './agreements.ts';
import { appRecordProbe } from './app-record.ts';
import { subscriptionGroupProbe } from './subscription-group.ts';
import { bundleIdProbe } from './bundle-id.ts';
import { distributionCertProbe } from './distribution-cert.ts';
import { exportComplianceProbe } from './export-compliance.ts';
import { iapProductsProbe } from './iap-products.ts';
import { iapCodeReferenceProbe } from './iap-code-reference.ts';
import { storeKitConfigProbe } from './store-kit-config.ts';
import { subscriptionsProbe } from './subscriptions.ts';
import { iapPricingProbe } from './iap-pricing.ts';
import { subscriptionOffersProbe } from './subscription-offers.ts';
import { sandboxTestersProbe } from './sandbox-testers.ts';
import { playAppProbe } from './play-app.ts';
import { playFirstUploadProbe } from './play-first-upload.ts';
import { playInternalTrackProbe } from './play-internal-track.ts';
import { ageRatingProbe } from './age-rating.ts';
import { listingUrlsProbe } from './listing-urls.ts';
import { accountDeletionProbe } from './account-deletion.ts';
import { demoAccountProbe } from './demo-account.ts';
import { profileEntitlementsProbe } from './profile-entitlements.ts';
import { screenshotsProbe } from './screenshots.ts';
import { versionCopyrightProbe } from './version-copyright.ts';
import { appPrivacyProbe } from './app-privacy.ts';
import type { AppDescriptor } from '@/types/app.js';
import type { LaunchConfig } from '@/types/config.js';
import type {
  AscReadinessApi,
  PlayReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
/** A minimal valid config; pass `products` to exercise the subscription-group scope. */
function config(products?: LaunchConfig['products']): LaunchConfig {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  if (products == null) return launchConfig;

  return { ...launchConfig, products };
}
/** A discovered app; override `bundleId`/`packageName` to scope it to a store. */
function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name: 'app', dir: '/a', configPath: '/a/app.json', ...overrides };
}
/** A read-only ASC fake - only the methods readiness reads exist, so a write is impossible by construction. */
function ascApi(overrides: Partial<AscReadinessApi> = {}): AscReadinessApi {
  function mockCall() {
    return Promise.resolve('app-1');
  }

  function mockCall2() {
    return Promise.resolve(true);
  }

  function mockCall3() {
    return Promise.resolve([{ id: 'g1' }]);
  }

  function mockCall4() {
    return Promise.resolve({ id: 'b1' });
  }

  function mockCall5() {
    return Promise.resolve([{ id: 'c1', expirationDate: '2099-01-01T00:00:00Z' }]);
  }

  function mockCall6() {
    return Promise.resolve([]);
  }

  function mockCall7() {
    return Promise.resolve([]);
  }

  function mockCall8() {
    return Promise.resolve([{ id: 't1' }]);
  }

  function mockCall9() {
    return Promise.resolve({ id: 'ipp' });
  }

  function mockCall10() {
    return Promise.resolve({ id: 'spp' });
  }

  function mockCall11() {
    return Promise.resolve([]);
  }

  function mockCall12() {
    return Promise.resolve('appinfo-1');
  }

  function mockCall13() {
    return Promise.resolve({
      attributes: { violenceCartoonOrFantasy: false },
    });
  }

  function mockCall14() {
    return Promise.resolve([{ locale: 'en-US', url: 'https://x.example/delete' }]);
  }

  function mockCall15() {
    return Promise.resolve([{ appStoreState: 'READY_FOR_SALE' }]);
  }

  function mockCall16() {
    return Promise.resolve({ id: 'ver-1', copyright: '2026 Acme' });
  }

  function mockCall17() {
    return Promise.resolve({ attributes: { demoAccountRequired: false } });
  }

  function mockCall18() {
    return Promise.resolve([{ capabilityType: 'PUSH_NOTIFICATIONS' }]);
  }

  function mockCall19() {
    return Promise.resolve([{ id: 'loc-1', locale: 'en-US' }]);
  }

  function mockCall20() {
    return Promise.resolve([{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_67' }]);
  }

  function mockCall21() {
    return Promise.resolve([{ id: 'shot-1' }]);
  }

  return {
    getAppId: vi.fn(mockCall),
    checkRequiredAgreements: vi.fn(mockCall2),
    listSubscriptionGroups: vi.fn(mockCall3),
    findBundleId: vi.fn(mockCall4),
    listDistributionCertificates: vi.fn(mockCall5),
    listInAppPurchases: vi.fn(mockCall6),
    listSubscriptions: vi.fn(mockCall7),
    listSandboxTesters: vi.fn(mockCall8),
    findInAppPurchasePricePoint: vi.fn(mockCall9),
    findSubscriptionPricePoint: vi.fn(mockCall10),
    listSubscriptionOfferCodes: vi.fn(mockCall11),
    getEditableAppInfoId: vi.fn(mockCall12),
    getAgeRatingDeclaration: vi.fn(mockCall13),
    listAccountDeletionUrls: vi.fn(mockCall14),
    listAppStoreVersions: vi.fn(mockCall15),
    findEditableAppStoreVersion: vi.fn(mockCall16),
    getAppStoreReviewDetail: vi.fn(mockCall17),
    listBundleIdCapabilities: vi.fn(mockCall18),
    listAppStoreVersionLocalizations: vi.fn(mockCall19),
    listScreenshotSets: vi.fn(mockCall20),
    listScreenshots: vi.fn(mockCall21),
    ...overrides,
  };
}
/** A read-only Play fake, mirroring {@link ascApi}. */
function playApi(overrides: Partial<PlayReadinessApi> = {}): PlayReadinessApi {
  function mockCall22() {
    return Promise.resolve(undefined);
  }

  function mockCall23() {
    return Promise.resolve(42);
  }

  function mockCall24() {
    return Promise.resolve([{ track: 'internal' }]);
  }

  return {
    assertAppExists: vi.fn(mockCall22),
    getLatestVersionCode: vi.fn(mockCall23),
    listTracks: vi.fn(mockCall24),
    ...overrides,
  };
}
/** Build a context with explicit clients (or `null` to simulate unconfigured credentials). */
function createReadinessContext(args: {
  apps: AppDescriptor[];
  asc?: AscReadinessApi | null;
  play?: PlayReadinessApi | null;
  products?: LaunchConfig['products'];
}): ReadinessContext {
  let appleStore: AscReadinessApi | null = null;

  if (args.asc != null) appleStore = args.asc;

  let googleStore: PlayReadinessApi | null = null;

  if (args.play != null) googleStore = args.play;

  return {
    config: config(args.products),
    apps: args.apps,
    resolveAscApi() {
      return Promise.resolve(appleStore);
    },
    resolvePlayApi() {
      return Promise.resolve(googleStore);
    },
  };
}
/** The per-app status + identifier of a `checked` result (empty for any other state). */
function findings(probeResult: ProbeResult): {
  status: string;
  identifier: string;
}[] {
  if (probeResult.state != 'checked') return [];

  function mapPiece({
    status,
    identifier,
  }: {
    readonly app: string;
    readonly identifier: string;
    readonly status: 'ok' | 'warn' | 'blocker';
    readonly detail: string;
    readonly hint?: string;
  }) {
    return { status, identifier };
  }

  return probeResult.apps.map(mapPiece);
}

/** Run a readiness probe. */
function checkProbe(
  probe: ReadinessProbe,
  readinessContext: ReadinessContext,
): Promise<ProbeResult> {
  return probe.check(readinessContext);
}

function stubFetchStatus(httpStatus: number): void {
  async function fetchListing(): Promise<Response> {
    return new Response(null, { status: httpStatus });
  }

  vi.stubGlobal('fetch', vi.fn(fetchListing));
}
/** An app selling one priced IAP - shared by the pricing and sandbox-tester probes. */
const withPricedIap: LaunchConfig['products'] = {
  'com.x': {
    inAppPurchases: [
      {
        productId: 'com.x.coins',
        referenceName: 'Coins',
        type: 'CONSUMABLE',
        localizations: [],
        price: { customerPrice: 9.99 },
      },
    ],
  },
};
/** An app selling a subscription that declares one offer-code campaign - shared by the offers probe. */
const withOffers: LaunchConfig['products'] = {
  'com.x': {
    subscriptionGroups: [
      {
        referenceName: 'g',
        localizations: [],
        subscriptions: [
          {
            productId: 'com.x.pro',
            referenceName: 'Pro',
            subscriptionPeriod: 'ONE_MONTH',
            localizations: [],
            offerCodes: [
              {
                name: 'LAUNCH50',
                duration: 'ONE_MONTH',
                offerMode: 'PAY_AS_YOU_GO',
                numberOfPeriods: 1,
                customerEligibilities: ['NEW'],
                offerEligibility: 'REPLACE_INTRO_OFFERS',
                prices: [{ customerPrice: 4.99 }],
              },
            ],
          },
        ],
      },
    ],
  },
};
function describeAppPieceProbe() {
  async function omitsItselfWhenNoAppHasABundleId() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probeResult = await checkProbe(appRecordProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  }

  it('omits itself when no app has a bundle id', omitsItselfWhenNoAppHasABundleId);

  async function skipsWhenNoAppleAccountIsConfigured() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: null,
    });
    const probeResult = await checkProbe(appRecordProbe, createReadiness);

    expect(probeResult.state).toBe('skipped');
  }

  it('skips when no Apple account is configured', skipsWhenNoAppleAccountIsConfigured);

  async function passesWhenTheAppPieceExistsBlocksWhenItDoesnT() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(appRecordProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall25() {
      return Promise.resolve(null);
    }

    const api = ascApi({
      getAppId: vi.fn(mockCall25),
    });
    const missing = await checkProbe(
      appRecordProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: api }),
    );

    expect(findings(missing)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(api.getAppId).toHaveBeenCalledWith('com.x');
  }

  it(
    "passes when the app record exists, blocks when it doesn't",
    passesWhenTheAppPieceExistsBlocksWhenItDoesnT,
  );
}

describe('appRecordProbe', describeAppPieceProbe);
function describeAgreementsProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(agreementsProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          agreementsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount,
  );

  async function passesWhenAgreementsAreInEffectBlocksWhenOneIsMissingExpiredOneAccountWideFinding() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(agreementsProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'account-wide' }]);

    function mockCall26() {
      return Promise.resolve(false);
    }

    const missing = ascApi({
      checkRequiredAgreements: vi.fn(mockCall26),
    });
    const blocked = await checkProbe(
      agreementsProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: missing }),
    );

    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'account-wide' }]);
  }

  it(
    'passes when agreements are in effect, blocks when one is missing/expired (one account-wide finding)',
    passesWhenAgreementsAreInEffectBlocksWhenOneIsMissingExpiredOneAccountWideFinding,
  );

  async function propagatesAnUnexpectedReadFailureSoTheOrchestratorRecordsItAsErrored() {
    function runPiece(): never {
      throw new Error('network down');
    }
    function mockCall68(): Promise<boolean> {
      return Promise.resolve(runPiece());
    }

    const broken = ascApi({
      checkRequiredAgreements: vi.fn(mockCall68),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: broken,
    });
    const probe = checkProbe(agreementsProbe, createReadiness);

    await expect(probe).rejects.toThrow('network down');
  }

  it(
    'propagates an unexpected read failure so the orchestrator records it as errored',
    propagatesAnUnexpectedReadFailureSoTheOrchestratorRecordsItAsErrored,
  );
}

describe('agreementsProbe', describeAgreementsProbe);
function describeSubscriptionGroupProbe() {
  const withSubs = {
    'com.x': { subscriptionGroups: [{ referenceName: 'g', localizations: [], subscriptions: [] }] },
  };

  async function omitsItselfWhenNoAppDeclaresSubscriptions() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(subscriptionGroupProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  }

  it('omits itself when no app declares subscriptions', omitsItselfWhenNoAppDeclaresSubscriptions);

  async function blocksWhenTheDeclaredGroupIsAbsentAndPassesWhenPresent() {
    function mockCall27() {
      return Promise.resolve([]);
    }

    const empty = ascApi({
      listSubscriptionGroups: vi.fn(mockCall27),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: empty,
      products: withSubs,
    });
    const missing = await checkProbe(subscriptionGroupProbe, createReadiness);
    const listedFindings = findings(missing);

    expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'com.x' }]);

    const ok = await checkProbe(
      subscriptionGroupProbe,
      createReadinessContext({
        apps: [app({ bundleId: 'com.x' })],
        asc: ascApi(),
        products: withSubs,
      }),
    );

    expect(findings(ok)).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it(
    'blocks when the declared group is absent and passes when present',
    blocksWhenTheDeclaredGroupIsAbsentAndPassesWhenPresent,
  );

  async function warnsInsteadOfBlockingWhenTheAppPieceIsnTThereToCheckAgainst() {
    function mockCall28() {
      return Promise.resolve(null);
    }

    const api = ascApi({
      getAppId: vi.fn(mockCall28),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: api,
      products: withSubs,
    });
    const probeResult = await checkProbe(subscriptionGroupProbe, createReadiness);
    const listedFindings = findings(probeResult);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns instead of blocking when the app record isn't there to check against",
    warnsInsteadOfBlockingWhenTheAppPieceIsnTThereToCheckAgainst,
  );
}

describe('subscriptionGroupProbe', describeSubscriptionGroupProbe);
function describeIapProductsProbe() {
  const withIap: LaunchConfig['products'] = {
    'com.x': {
      inAppPurchases: [
        { productId: 'com.x.coins', referenceName: 'Coins', type: 'CONSUMABLE', localizations: [] },
      ],
    },
  };

  async function omitsWhenNoAppDeclaresOneTimeIAPsSkipsWithoutAnAppleAccount() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(iapProductsProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          iapProductsProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: null,
            products: withIap,
          }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits when no app declares one-time IAPs, skips without an Apple account',
    omitsWhenNoAppDeclaresOneTimeIAPsSkipsWithoutAnAppleAccount,
  );

  async function passesAPresentProductBlocksAMissingOneAndAMISSINGMETADATAOne() {
    function mockCall29() {
      return Promise.resolve([{ productId: 'com.x.coins', state: 'READY_TO_SUBMIT' }]);
    }

    const present = ascApi({
      listInAppPurchases: vi.fn(mockCall29),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withIap,
    });
    const probe = await checkProbe(iapProductsProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.coins' }]);

    function mockCall30() {
      return Promise.resolve([]);
    }

    const absent = ascApi({
      listInAppPurchases: vi.fn(mockCall30),
    });

    expect(
      findings(
        await checkProbe(
          iapProductsProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: absent,
            products: withIap,
          }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x.coins' }]);

    function mockCall31() {
      return Promise.resolve([{ productId: 'com.x.coins', state: 'MISSING_METADATA' }]);
    }

    const incomplete = ascApi({
      listInAppPurchases: vi.fn(mockCall31),
    });

    expect(
      findings(
        await checkProbe(
          iapProductsProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: incomplete,
            products: withIap,
          }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x.coins' }]);
  }

  it(
    'passes a present product, blocks a missing one and a MISSING_METADATA one',
    passesAPresentProductBlocksAMissingOneAndAMISSINGMETADATAOne,
  );

  async function warnsInsteadOfBlockingWhenTheAppPieceIsnTThereToCheckAgainst2() {
    function mockCall32() {
      return Promise.resolve(null);
    }

    const noApp = ascApi({
      getAppId: vi.fn(mockCall32),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
      products: withIap,
    });
    const probeResult = await checkProbe(iapProductsProbe, createReadiness);
    const listedFindings = findings(probeResult);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns instead of blocking when the app record isn't there to check against",
    warnsInsteadOfBlockingWhenTheAppPieceIsnTThereToCheckAgainst2,
  );
}

describe('iapProductsProbe', describeIapProductsProbe);
function describeSubscriptionsProbe() {
  const withSub: LaunchConfig['products'] = {
    'com.x': {
      subscriptionGroups: [
        {
          referenceName: 'g',
          localizations: [],
          subscriptions: [
            {
              productId: 'com.x.pro',
              referenceName: 'Pro',
              subscriptionPeriod: 'ONE_MONTH',
              localizations: [],
            },
          ],
        },
      ],
    },
  };

  async function omitsWhenNoAppDeclaresSubscriptions() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(subscriptionsProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  }

  it('omits when no app declares subscriptions', omitsWhenNoAppDeclaresSubscriptions);

  async function passesAPresentSubscriptionBlocksAMissingOneAcrossTheAppSGroups() {
    function mockCall33() {
      return Promise.resolve([{ productId: 'com.x.pro', state: 'READY_TO_SUBMIT' }]);
    }

    const present = ascApi({
      listSubscriptions: vi.fn(mockCall33),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withSub,
    });
    const probe = await checkProbe(subscriptionsProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.pro' }]);

    function mockCall34() {
      return Promise.resolve([]);
    }

    const absent = ascApi({
      listSubscriptions: vi.fn(mockCall34),
    });

    expect(
      findings(
        await checkProbe(
          subscriptionsProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: absent,
            products: withSub,
          }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x.pro' }]);
  }

  it(
    "passes a present subscription, blocks a missing one (across the app's groups)",
    passesAPresentSubscriptionBlocksAMissingOneAcrossTheAppSGroups,
  );
}

describe('subscriptionsProbe', describeSubscriptionsProbe);
function describeBundleIdProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount2() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(bundleIdProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          bundleIdProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount2,
  );

  async function passesWhenTheBundleIDIsRegisteredBlocksWhenItIsnT() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(bundleIdProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall35() {
      return Promise.resolve(null);
    }

    const api = ascApi({
      findBundleId: vi.fn(mockCall35),
    });
    const missing = await checkProbe(
      bundleIdProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: api }),
    );

    expect(findings(missing)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(api.findBundleId).toHaveBeenCalledWith('com.x');
  }

  it(
    "passes when the Bundle ID is registered, blocks when it isn't",
    passesWhenTheBundleIDIsRegisteredBlocksWhenItIsnT,
  );
}

describe('bundleIdProbe', describeBundleIdProbe);
function describeDistributionCertProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount3() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(distributionCertProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          distributionCertProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount3,
  );

  async function passesOnAnUnexpiredCertBlocksWhenNoneExistOrAllAreExpiredOneTeamWideFinding() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(distributionCertProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'team-wide' }]);

    function mockCall36() {
      return Promise.resolve([]);
    }

    const none = ascApi({
      listDistributionCertificates: vi.fn(mockCall36),
    });
    const blockedNone = await checkProbe(
      distributionCertProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: none }),
    );

    expect(findings(blockedNone)).toEqual([{ status: 'blocker', identifier: 'team-wide' }]);

    function mockCall37() {
      return Promise.resolve([{ id: 'c1', expirationDate: '2000-01-01T00:00:00Z' }]);
    }

    const expired = ascApi({
      listDistributionCertificates: vi.fn(mockCall37),
    });
    const blockedExpired = await checkProbe(
      distributionCertProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: expired }),
    );

    expect(findings(blockedExpired)).toEqual([{ status: 'blocker', identifier: 'team-wide' }]);
  }

  it(
    'passes on an unexpired cert, blocks when none exist or all are expired (one team-wide finding)',
    passesOnAnUnexpiredCertBlocksWhenNoneExistOrAllAreExpiredOneTeamWideFinding,
  );

  async function treatsACertificateWithNoRecordedExpiryAsUsable() {
    function mockCall38() {
      return Promise.resolve([{ id: 'c1' }]);
    }

    const undated = ascApi({
      listDistributionCertificates: vi.fn(mockCall38),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: undated,
    });
    const ok = await checkProbe(distributionCertProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'team-wide' }]);
  }

  it(
    'treats a certificate with no recorded expiry as usable',
    treatsACertificateWithNoRecordedExpiryAsUsable,
  );
}

describe('distributionCertProbe', describeDistributionCertProbe);
function describeExportComplianceProbe() {
  async function omitsWhenNoAppDeclaresABundleId() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(exportComplianceProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  }

  it('omits when no app declares a bundle id', omitsWhenNoAppDeclaresABundleId);

  async function passesWhenDeclaredEvenFalseWarnsWhenUndeclaredNeedsNoCredentials() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x', usesNonExemptEncryption: false })],
      asc: null,
    });
    const declared = await checkProbe(exportComplianceProbe, createReadiness);
    const listedFindings = findings(declared);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    const undeclared = await checkProbe(
      exportComplianceProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
    );

    expect(findings(undeclared)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    'passes when declared (even `false`), warns when undeclared - needs no credentials',
    passesWhenDeclaredEvenFalseWarnsWhenUndeclaredNeedsNoCredentials,
  );
}

describe('exportComplianceProbe', describeExportComplianceProbe);
function describePlayAppProbe() {
  async function passesWhenTheAppIsReachableBlocksWhenPlayRejectsIt() {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playAppProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function runPiece2() {
      throw new Error('app not found');
    }
    function mockCall69() {
      return Promise.resolve(runPiece2());
    }

    const denied = playApi({
      assertAppExists: vi.fn(mockCall69),
    });
    const blocked = await checkProbe(
      playAppProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: denied }),
    );

    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  }

  it(
    'passes when the app is reachable, blocks when Play rejects it',
    passesWhenTheAppIsReachableBlocksWhenPlayRejectsIt,
  );
}

describe('playAppProbe', describePlayAppProbe);
function describePlayFirstUploadProbe() {
  async function passesWithAnUploadedBuildBlocksAtVersionCode0WarnsOnAReadFailure() {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playFirstUploadProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall39() {
      return Promise.resolve(0);
    }

    const none = playApi({
      getLatestVersionCode: vi.fn(mockCall39),
    });
    const blocked = await checkProbe(
      playFirstUploadProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: none }),
    );

    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);

    function runPiece3(): never {
      throw new Error('nope');
    }
    function mockCall70(): Promise<number> {
      return Promise.resolve(runPiece3());
    }

    const broken = playApi({
      getLatestVersionCode: vi.fn(mockCall70),
    });
    const warned = await checkProbe(
      playFirstUploadProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: broken }),
    );

    expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    'passes with an uploaded build, blocks at versionCode 0, warns on a read failure',
    passesWithAnUploadedBuildBlocksAtVersionCode0WarnsOnAReadFailure,
  );
}

describe('playFirstUploadProbe', describePlayFirstUploadProbe);
function describePlayInternalTrackProbe() {
  async function passesWhenAnInternalTrackExistsWarnsWhenItDoesnT() {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playInternalTrackProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall40() {
      return Promise.resolve([{ track: 'production' }]);
    }

    const noTrack = playApi({
      listTracks: vi.fn(mockCall40),
    });
    const warned = await checkProbe(
      playInternalTrackProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: noTrack }),
    );

    expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "passes when an internal track exists, warns when it doesn't",
    passesWhenAnInternalTrackExistsWarnsWhenItDoesnT,
  );
}

describe('playInternalTrackProbe', describePlayInternalTrackProbe);
function describeIapPricingProbe() {
  async function omitsWhenNoAppDeclaresAPricedProductSkipsWithoutAnAppleAccount() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(iapPricingProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          iapPricingProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: null,
            products: withPricedIap,
          }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits when no app declares a priced product, skips without an Apple account',
    omitsWhenNoAppDeclaresAPricedProductSkipsWithoutAnAppleAccount,
  );

  async function passesAValidPricePointBlocksAnInvalidOne() {
    const live = [{ id: 'iap1', productId: 'com.x.coins', state: 'READY_TO_SUBMIT' }];

    function mockCall41() {
      return Promise.resolve(live);
    }

    const valid = ascApi({
      listInAppPurchases: vi.fn(mockCall41),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: valid,
      products: withPricedIap,
    });
    const probe = await checkProbe(iapPricingProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.coins' }]);

    function mockCall42() {
      return Promise.resolve(live);
    }

    function mockCall43() {
      return Promise.resolve(null);
    }

    const invalid = ascApi({
      listInAppPurchases: vi.fn(mockCall42),
      findInAppPurchasePricePoint: vi.fn(mockCall43),
    });

    expect(
      findings(
        await checkProbe(
          iapPricingProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: invalid,
            products: withPricedIap,
          }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x.coins' }]);
  }

  it('passes a valid price point, blocks an invalid one', passesAValidPricePointBlocksAnInvalidOne);

  async function warnsWhenTheProductIsnTOnAppStoreConnectYetAndWhenThereSNoAppPiece() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withPricedIap,
    });
    const notLive = await checkProbe(iapPricingProbe, createReadiness);
    const listedFindings = findings(notLive);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x.coins' }]);

    function mockCall44() {
      return Promise.resolve(null);
    }

    const noApp = ascApi({
      getAppId: vi.fn(mockCall44),
    });
    const probeResult = await checkProbe(
      iapPricingProbe,
      createReadinessContext({
        apps: [app({ bundleId: 'com.x' })],
        asc: noApp,
        products: withPricedIap,
      }),
    );

    expect(findings(probeResult)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns when the product isn't on App Store Connect yet, and when there's no app record",
    warnsWhenTheProductIsnTOnAppStoreConnectYetAndWhenThereSNoAppPiece,
  );
}

describe('iapPricingProbe', describeIapPricingProbe);
function describeSubscriptionOffersProbe() {
  async function omitsWhenNoSubscriptionDeclaresOfferCodesSkipsWithoutAnAppleAccount() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(subscriptionOffersProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          subscriptionOffersProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: null,
            products: withOffers,
          }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits when no subscription declares offer codes, skips without an Apple account',
    omitsWhenNoSubscriptionDeclaresOfferCodesSkipsWithoutAnAppleAccount,
  );

  async function passesAPresentOfferCodeWarnsOnAMissingOne() {
    const live = [{ id: 's1', productId: 'com.x.pro', state: 'READY_TO_SUBMIT' }];

    function mockCall45() {
      return Promise.resolve(live);
    }

    function mockCall46() {
      return Promise.resolve([{ name: 'LAUNCH50' }]);
    }

    const present = ascApi({
      listSubscriptions: vi.fn(mockCall45),
      listSubscriptionOfferCodes: vi.fn(mockCall46),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withOffers,
    });
    const probe = await checkProbe(subscriptionOffersProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.pro-LAUNCH50' }]);

    function mockCall47() {
      return Promise.resolve(live);
    }

    function mockCall48() {
      return Promise.resolve([]);
    }

    const missing = ascApi({
      listSubscriptions: vi.fn(mockCall47),
      listSubscriptionOfferCodes: vi.fn(mockCall48),
    });

    expect(
      findings(
        await checkProbe(
          subscriptionOffersProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: missing,
            products: withOffers,
          }),
        ),
      ),
    ).toEqual([{ status: 'warn', identifier: 'com.x.pro-LAUNCH50' }]);
  }

  it(
    'passes a present offer code, warns on a missing one',
    passesAPresentOfferCodeWarnsOnAMissingOne,
  );

  async function warnsDeferringToTheSubscriptionsProbeWhenTheSubscriptionIsnTOnAppStoreConnectYet() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withOffers,
    });
    const probeResult = await checkProbe(subscriptionOffersProbe, createReadiness);
    const listedFindings = findings(probeResult);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x.pro' }]);
  }

  it(
    "warns (deferring to the subscriptions probe) when the subscription isn't on App Store Connect yet",
    warnsDeferringToTheSubscriptionsProbeWhenTheSubscriptionIsnTOnAppStoreConnectYet,
  );
}

describe('subscriptionOffersProbe', describeSubscriptionOffersProbe);
function describeSandboxTestersProbe() {
  async function omitsWhenNoAppSellsProductsSkipsWithoutAnAppleAccount() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(sandboxTestersProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          sandboxTestersProbe,
          createReadinessContext({
            apps: [app({ bundleId: 'com.x' })],
            asc: null,
            products: withPricedIap,
          }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits when no app sells products, skips without an Apple account',
    omitsWhenNoAppSellsProductsSkipsWithoutAnAppleAccount,
  );

  async function passesWith1TesterWarnsWithNoneOneAccountWideFinding() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withPricedIap,
    });
    const ok = await checkProbe(sandboxTestersProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'account-wide' }]);

    function mockCall49() {
      return Promise.resolve([]);
    }

    const none = ascApi({
      listSandboxTesters: vi.fn(mockCall49),
    });
    const warned = await checkProbe(
      sandboxTestersProbe,
      createReadinessContext({
        apps: [app({ bundleId: 'com.x' })],
        asc: none,
        products: withPricedIap,
      }),
    );

    expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'account-wide' }]);
  }

  it(
    'passes with >=1 tester, warns with none (one account-wide finding)',
    passesWith1TesterWarnsWithNoneOneAccountWideFinding,
  );
}

describe('sandboxTestersProbe', describeSandboxTestersProbe);
/** The first finding's `detail` string from a `checked` result (empty otherwise) - for asserting copy. */
function firstDetail(probeResult: ProbeResult): string {
  if (probeResult.state != 'checked') return '';

  const firstFinding = probeResult.apps[0];

  if (firstFinding == null) return '';

  return firstFinding.detail;
}
/** A products catalog declaring a single one-time IAP under `com.x`. */
const oneIap: LaunchConfig['products'] = {
  'com.x': {
    inAppPurchases: [
      { productId: 'com.x.coins', referenceName: 'Coins', type: 'CONSUMABLE', localizations: [] },
    ],
  },
};
function describeIapCodeReferenceProbe() {
  async function omitsWhenTheAppDeclaresNoProductsNoScan() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(iapCodeReferenceProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  }

  it('omits when the app declares no products (no scan)', omitsWhenTheAppDeclaresNoProductsNoScan);

  async function passesWhenEveryDeclaredIdAppearsInPieceWarnsNamingItWhenOneDoesnT() {
    const systemTemporaryDirectory = tmpdir();
    const iapScanPath = join(systemTemporaryDirectory, 'iap-scan-');
    const dir = mkdtempSync(iapScanPath);

    try {
      const purchasesPath = join(dir, 'purchases.ts');

      writeFileSync(purchasesPath, `await buy("com.x.coins");\n`);

      const createReadiness = createReadinessContext({
        apps: [app({ bundleId: 'com.x', dir })],
        products: oneIap,
      });
      const ok = await checkProbe(iapCodeReferenceProbe, createReadiness);
      const listedFindings = findings(ok);

      expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

      const twoIds: LaunchConfig['products'] = {
        'com.x': {
          inAppPurchases: [
            {
              productId: 'com.x.coins',
              referenceName: 'Coins',
              type: 'CONSUMABLE',
              localizations: [],
            },
            {
              productId: 'com.x.ghost',
              referenceName: 'Ghost',
              type: 'CONSUMABLE',
              localizations: [],
            },
          ],
        },
      };
      const warned = await checkProbe(
        iapCodeReferenceProbe,
        createReadinessContext({ apps: [app({ bundleId: 'com.x', dir })], products: twoIds }),
      );

      expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
      expect(firstDetail(warned)).toContain('com.x.ghost');
      expect(firstDetail(warned)).not.toContain('com.x.coins');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    "passes when every declared id appears in source, warns (naming it) when one doesn't",
    passesWhenEveryDeclaredIdAppearsInPieceWarnsNamingItWhenOneDoesnT,
  );

  async function doesNotScanNodeModulesAReferenceThereDoesNotCountAsARealOne() {
    const systemTemporaryDirectory = tmpdir();
    const iapScanPath = join(systemTemporaryDirectory, 'iap-scan-');
    const dir = mkdtempSync(iapScanPath);

    try {
      const pkgPath = join(dir, 'node_modules', 'pkg');

      mkdirSync(pkgPath, { recursive: true });

      const indexPath = join(dir, 'node_modules', 'pkg', 'index.js');

      writeFileSync(indexPath, `const id = "com.x.coins";\n`);

      const createReadiness = createReadinessContext({
        apps: [app({ bundleId: 'com.x', dir })],
        products: oneIap,
      });
      const probeResult = await checkProbe(iapCodeReferenceProbe, createReadiness);
      const listedFindings = findings(probeResult);

      expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    'does not scan node_modules - a reference there does not count as a real one',
    doesNotScanNodeModulesAReferenceThereDoesNotCountAsARealOne,
  );
}

describe('iapCodeReferenceProbe', describeIapCodeReferenceProbe);
function describeStoreKitPieceProbe() {
  async function omitsWhenTheAppDeclaresNoProducts() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(storeKitConfigProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  }

  it('omits when the app declares no products', omitsWhenTheAppDeclaresNoProducts);

  async function warnsWhenNoStorekitFileExistsPassesOnceOneIsAdded() {
    const systemTemporaryDirectory = tmpdir();
    const storekitPath = join(systemTemporaryDirectory, 'storekit-');
    const dir = mkdtempSync(storekitPath);

    try {
      const createReadiness = createReadinessContext({
        apps: [app({ bundleId: 'com.x', dir })],
        products: oneIap,
      });
      const warned = await checkProbe(storeKitConfigProbe, createReadiness);
      const listedFindings = findings(warned);

      expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);

      const productsPath = join(dir, 'Products.storekit');

      writeFileSync(productsPath, '{}');

      const ok = await checkProbe(
        storeKitConfigProbe,
        createReadinessContext({ apps: [app({ bundleId: 'com.x', dir })], products: oneIap }),
      );

      expect(findings(ok)).toEqual([{ status: 'ok', identifier: 'com.x' }]);
      expect(firstDetail(ok)).toContain('Products.storekit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    'warns when no .storekit file exists, passes once one is added',
    warnsWhenNoStorekitFileExistsPassesOnceOneIsAdded,
  );
}

describe('storeKitConfigProbe', describeStoreKitPieceProbe);
function describeAgeRatingProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount4() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(ageRatingProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          ageRatingProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount4,
  );

  async function passesACompletedQuestionnaireBlocksAnEmptyOrNeverTouchedOne() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(ageRatingProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall50() {
      return Promise.resolve({ attributes: {} });
    }

    const empty = ascApi({
      getAgeRatingDeclaration: vi.fn(mockCall50),
    });
    const probe = await checkProbe(
      ageRatingProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: empty }),
    );

    expect(findings(probe)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);

    function mockCall51() {
      return Promise.resolve(null);
    }

    const untouched = ascApi({
      getAgeRatingDeclaration: vi.fn(mockCall51),
    });

    expect(
      findings(
        await checkProbe(
          ageRatingProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: untouched }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  }

  it(
    'passes a completed questionnaire, blocks an empty or never-touched one',
    passesACompletedQuestionnaireBlocksAnEmptyOrNeverTouchedOne,
  );

  async function warnsInsteadOfBlockingWhenThereSNoAppPieceOrNoEditableVersionToRead() {
    function mockCall52() {
      return Promise.resolve(null);
    }

    const noApp = ascApi({
      getAppId: vi.fn(mockCall52),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(ageRatingProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);

    function mockCall53() {
      return Promise.resolve(null);
    }

    const noInfo = ascApi({
      getEditableAppInfoId: vi.fn(mockCall53),
    });

    expect(
      findings(
        await checkProbe(
          ageRatingProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noInfo }),
        ),
      ),
    ).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns instead of blocking when there's no app record or no editable version to read",
    warnsInsteadOfBlockingWhenThereSNoAppPieceOrNoEditableVersionToRead,
  );
}

describe('ageRatingProbe', describeAgeRatingProbe);
function describeAccountDeletionProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount5() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(accountDeletionProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          accountDeletionProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount5,
  );

  async function passesWhenAURLIsDeclaredInAnyLocaleWarnsWhenNoneIsSet() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(accountDeletionProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall54() {
      return Promise.resolve([{ locale: 'en-US', url: '' }]);
    }

    const none = ascApi({
      listAccountDeletionUrls: vi.fn(mockCall54),
    });
    const probe = await checkProbe(
      accountDeletionProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: none }),
    );

    expect(findings(probe)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    'passes when a URL is declared in any locale, warns when none is set',
    passesWhenAURLIsDeclaredInAnyLocaleWarnsWhenNoneIsSet,
  );

  async function warnsWhenThereSNoAppPieceOrNoEditableAppPieceToRead() {
    function mockCall55() {
      return Promise.resolve(null);
    }

    const noApp = ascApi({
      getAppId: vi.fn(mockCall55),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(accountDeletionProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns when there's no app record or no editable app info to read",
    warnsWhenThereSNoAppPieceOrNoEditableAppPieceToRead,
  );
}

describe('accountDeletionProbe', describeAccountDeletionProbe);
function describeDemoAccountProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount6() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(demoAccountProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          demoAccountProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount6,
  );

  async function passesWhenSignInIsnTRequiredOrWhenItIsAndADemoAccountIsProvided() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const notRequired = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(notRequired);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall56() {
      return Promise.resolve({
        attributes: { demoAccountRequired: true, demoAccountName: 'review@x.example' },
      });
    }

    const provided = ascApi({
      getAppStoreReviewDetail: vi.fn(mockCall56),
    });
    const probe = await checkProbe(
      demoAccountProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: provided }),
    );

    expect(findings(probe)).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it(
    "passes when sign-in isn't required, or when it is and a demo account is provided",
    passesWhenSignInIsnTRequiredOrWhenItIsAndADemoAccountIsProvided,
  );

  async function blocksWhenSignInIsRequiredButNoDemoAccountNameIsSet() {
    function mockCall57() {
      return Promise.resolve({ attributes: { demoAccountRequired: true } });
    }

    const missing = ascApi({
      getAppStoreReviewDetail: vi.fn(mockCall57),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: missing,
    });
    const probe = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  }

  it(
    'blocks when sign-in is required but no demo account name is set',
    blocksWhenSignInIsRequiredButNoDemoAccountNameIsSet,
  );

  async function warnsWhenAppReviewDetailsTheAppPieceOrAnEditableVersionAreMissing() {
    function mockCall58() {
      return Promise.resolve(null);
    }

    const noDetail = ascApi({
      getAppStoreReviewDetail: vi.fn(mockCall58),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noDetail,
    });
    const probe = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);

    function mockCall59() {
      return Promise.resolve(null);
    }

    const noVersion = ascApi({
      findEditableAppStoreVersion: vi.fn(mockCall59),
    });

    expect(
      findings(
        await checkProbe(
          demoAccountProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noVersion }),
        ),
      ),
    ).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    'warns when App Review details, the app record, or an editable version are missing',
    warnsWhenAppReviewDetailsTheAppPieceOrAnEditableVersionAreMissing,
  );
}

describe('demoAccountProbe', describeDemoAccountProbe);
function describeProfileEntitlementsProbe() {
  /** An app whose entitlements require the Push Notifications capability on its App ID. */
  const pushApp = app({ bundleId: 'com.x', iosEntitlements: { 'aps-environment': 'production' } });

  async function omitsWhenNoInScopeAppDeclaresCapabilityBearingEntitlements() {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  }

  it(
    'omits when no in-scope app declares capability-bearing entitlements',
    omitsWhenNoInScopeAppDeclaresCapabilityBearingEntitlements,
  );

  async function skipsWithoutAnAppleAccountWhenAnAppDoesDeclareEntitlements() {
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: null });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    expect(probe.state).toBe('skipped');
  }

  it(
    'skips without an Apple account when an app does declare entitlements',
    skipsWithoutAnAppleAccountWhenAnAppDoesDeclareEntitlements,
  );

  async function passesWhenTheAppIDSCapabilitiesCoverTheEntitlementsBlocksWhenOneIsMissing() {
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: ascApi() });
    const ok = await checkProbe(profileEntitlementsProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);

    function mockCall60() {
      return Promise.resolve([]);
    }

    const missing = ascApi({
      listBundleIdCapabilities: vi.fn(mockCall60),
    });
    const blocked = await checkProbe(
      profileEntitlementsProbe,
      createReadinessContext({ apps: [pushApp], asc: missing }),
    );

    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(firstDetail(blocked)).toContain('PUSH_NOTIFICATIONS');
  }

  it(
    "passes when the App ID's capabilities cover the entitlements, blocks when one is missing",
    passesWhenTheAppIDSCapabilitiesCoverTheEntitlementsBlocksWhenOneIsMissing,
  );

  async function warnsWhenTheAppIDIsnTRegisteredYet() {
    function mockCall61() {
      return Promise.resolve(null);
    }

    const noBundle = ascApi({
      findBundleId: vi.fn(mockCall61),
    });
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: noBundle });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it("warns when the App ID isn't registered yet", warnsWhenTheAppIDIsnTRegisteredYet);
}

describe('profileEntitlementsProbe', describeProfileEntitlementsProbe);
function describeScreenshotsProbe() {
  async function omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount7() {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(screenshotsProbe, createReadiness);

    expect(probe.state).toBe('omitted');
    expect(
      (
        await checkProbe(
          screenshotsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: null }),
        )
      ).state,
    ).toBe('skipped');
  }

  it(
    'omits without an iOS app and skips without an Apple account',
    omitsWithoutAnIOSAppAndSkipsWithoutAnAppleAccount7,
  );

  async function passesWhenTheRequired67ClassHasAScreenshot() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it(
    'passes when the required 6.7" class has a screenshot',
    passesWhenTheRequired67ClassHasAScreenshot,
  );

  async function warnsWhenIPhoneScreenshotsExistButNotForTheRequiredClassBlocksWhenNoneExist() {
    function mockCall62() {
      return Promise.resolve([{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_65' }]);
    }

    const otherClass = ascApi({
      listScreenshotSets: vi.fn(mockCall62),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: otherClass,
    });
    const probe = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);

    function mockCall63() {
      return Promise.resolve([]);
    }

    const noShots = ascApi({
      listScreenshots: vi.fn(mockCall63),
    });

    expect(
      findings(
        await checkProbe(
          screenshotsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noShots }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);

    function mockCall64() {
      return Promise.resolve([]);
    }

    const noSets = ascApi({
      listScreenshotSets: vi.fn(mockCall64),
    });

    expect(
      findings(
        await checkProbe(
          screenshotsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noSets }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  }

  it(
    'warns when iPhone screenshots exist but not for the required class, blocks when none exist',
    warnsWhenIPhoneScreenshotsExistButNotForTheRequiredClassBlocksWhenNoneExist,
  );

  async function warnsWhenThereSNoAppPieceOrNoEditableVersionToRead() {
    function mockCall65() {
      return Promise.resolve(null);
    }

    const noApp = ascApi({
      getAppId: vi.fn(mockCall65),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(probe);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  }

  it(
    "warns when there's no app record or no editable version to read",
    warnsWhenThereSNoAppPieceOrNoEditableVersionToRead,
  );
}

describe('screenshotsProbe', describeScreenshotsProbe);
function describeListingUrlsProbe() {
  /** Write a minimal `store.config.json` declaring one Apple privacy-policy URL, and return its dir. */
  function appDirWithPrivacyUrl(url: string): string {
    const systemTemporaryDirectory = tmpdir();
    const listingUrlsPath = join(systemTemporaryDirectory, 'listing-urls-');
    const dir = mkdtempSync(listingUrlsPath);
    const storePath = join(dir, 'store.config.json');
    const serialized = JSON.stringify({ apple: { info: { 'en-US': { privacyPolicyUrl: url } } } });

    writeFileSync(storePath, serialized);

    return dir;
  }
  async function omitsWhenNoInScopeAppDeclaresAListingURL() {
    const systemTemporaryDirectory = tmpdir();
    const listingUrlsPath = join(systemTemporaryDirectory, 'listing-urls-');
    const dir = mkdtempSync(listingUrlsPath);

    try {
      const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x', dir })] });
      const probe = await checkProbe(listingUrlsProbe, createReadiness);
      expect(probe.state).toBe('omitted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('omits when no in-scope app declares a listing URL', omitsWhenNoInScopeAppDeclaresAListingURL);

  async function passesA2xxURLAndBlocksANon2xxOne() {
    const dir = appDirWithPrivacyUrl('https://x.example/privacy');

    try {
      stubFetchStatus(200);

      const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x', dir })] });
      const ok = await checkProbe(listingUrlsProbe, createReadiness);
      const listedFindings = findings(ok);

      expect(listedFindings).toEqual([{ status: 'ok', identifier: 'https://x.example/privacy' }]);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }

    const dir2 = appDirWithPrivacyUrl('https://x.example/gone');

    try {
      stubFetchStatus(404);

      const createReadiness = createReadinessContext({
        apps: [app({ bundleId: 'com.x', dir: dir2 })],
      });
      const blocked = await checkProbe(listingUrlsProbe, createReadiness);
      const listedFindings = findings(blocked);

      expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'https://x.example/gone' }]);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir2, { recursive: true, force: true });
    }
  }

  it('passes a 2xx URL and blocks a non-2xx one', passesA2xxURLAndBlocksANon2xxOne);

  async function propagatesAFetchFailureSoTheOrchestratorRecordsItAsErrored() {
    const dir = appDirWithPrivacyUrl('https://x.example/privacy');

    async function failFetch(): Promise<Response> {
      throw new Error('ENOTFOUND');
    }

    vi.stubGlobal('fetch', vi.fn(failFetch));

    try {
      const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x', dir })] });
      const probe = checkProbe(listingUrlsProbe, createReadiness);
      await expect(probe).rejects.toThrow('ENOTFOUND');
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    'propagates a fetch failure so the orchestrator records it as errored',
    propagatesAFetchFailureSoTheOrchestratorRecordsItAsErrored,
  );
}

describe('listingUrlsProbe', describeListingUrlsProbe);
function describeVersionCopyrightProbe() {
  function mockCall66() {
    return Promise.resolve({ id: 'ver-1', copyright: '' });
  }

  const emptyCopyright = ascApi({
    findEditableAppStoreVersion: vi.fn(mockCall66),
  });

  async function passesWhenTheEditableVersionHasACopyright() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(versionCopyrightProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it('passes when the editable version has a copyright', passesWhenTheEditableVersionHasACopyright);

  async function blocksWhenTheEditableVersionHasAnEmptyCopyright() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: emptyCopyright,
    });
    const blocked = await checkProbe(versionCopyrightProbe, createReadiness);
    const listedFindings = findings(blocked);

    expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  }

  it(
    'blocks when the editable version has an empty copyright',
    blocksWhenTheEditableVersionHasAnEmptyCopyright,
  );

  async function passesAnEmptyCopyrightThatReleaseCopyrightWillFill() {
    const readinessContext = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: emptyCopyright,
    });
    const configured = await checkProbe(versionCopyrightProbe, {
      ...readinessContext,
      config: { ...readinessContext.config, release: { copyright: '2026 Acme' } },
    });
    const listedFindings = findings(configured);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it(
    'passes an empty copyright that release.copyright will fill',
    passesAnEmptyCopyrightThatReleaseCopyrightWillFill,
  );
}

describe('versionCopyrightProbe', describeVersionCopyrightProbe);
function describeAppPrivacyProbe() {
  async function passesAnAppThatHasBeenReleasedBefore() {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(appPrivacyProbe, createReadiness);
    const listedFindings = findings(ok);

    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  }

  it('passes an app that has been released before', passesAnAppThatHasBeenReleasedBefore);

  async function listsAppPrivacyAsAManualStepForAFirstVersion() {
    function mockCall67() {
      return Promise.resolve([{ appStoreState: 'PREPARE_FOR_SUBMISSION' }]);
    }

    const firstVersionOnly = ascApi({
      listAppStoreVersions: vi.fn(mockCall67),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: firstVersionOnly,
    });
    const firstVersion = await checkProbe(appPrivacyProbe, createReadiness);
    const listedFindings = findings(firstVersion);

    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    expect(firstVersionOnly.listAppStoreVersions).toHaveBeenCalledWith('app-1', 'IOS');
  }

  it(
    'lists App Privacy as a manual step for a first version',
    listsAppPrivacyAsAManualStepForAFirstVersion,
  );
}

describe('appPrivacyProbe', describeAppPrivacyProbe);
