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
import type { AppDescriptor } from '../../types/app.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type {
  AscReadinessApi,
  PlayReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
/** A minimal valid config; pass `products` to exercise the subscription-group scope. */
const config = (products?: LaunchConfig['products']): LaunchConfig => {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };
  if (products == null) return launchConfig;
  return { ...launchConfig, products };
};
/** A discovered app; override `bundleId`/`packageName` to scope it to a store. */
const app = (overrides: Partial<AppDescriptor> = {}): AppDescriptor => {
  return { name: 'app', dir: '/a', configPath: '/a/app.json', ...overrides };
};
/** A read-only ASC fake - only the methods readiness reads exist, so a write is impossible by construction. */
const ascApi = (overrides: Partial<AscReadinessApi> = {}): AscReadinessApi => {
  return {
    getAppId: vi.fn(() => Promise.resolve('app-1')),
    checkRequiredAgreements: vi.fn(() => Promise.resolve(true)),
    listSubscriptionGroups: vi.fn(() => Promise.resolve([{ id: 'g1' }])),
    findBundleId: vi.fn(() => Promise.resolve({ id: 'b1' })),
    listDistributionCertificates: vi.fn(() =>
      Promise.resolve([{ id: 'c1', expirationDate: '2099-01-01T00:00:00Z' }]),
    ),
    listInAppPurchases: vi.fn(() => Promise.resolve([])),
    listSubscriptions: vi.fn(() => Promise.resolve([])),
    listSandboxTesters: vi.fn(() => Promise.resolve([{ id: 't1' }])),
    findInAppPurchasePricePoint: vi.fn(() => Promise.resolve({ id: 'ipp' })),
    findSubscriptionPricePoint: vi.fn(() => Promise.resolve({ id: 'spp' })),
    listSubscriptionOfferCodes: vi.fn(() => Promise.resolve([])),
    getEditableAppInfoId: vi.fn(() => Promise.resolve('appinfo-1')),
    getAgeRatingDeclaration: vi.fn(() =>
      Promise.resolve({
        attributes: { violenceCartoonOrFantasy: false },
      }),
    ),
    listAccountDeletionUrls: vi.fn(() =>
      Promise.resolve([{ locale: 'en-US', url: 'https://x.example/delete' }]),
    ),
    listAppStoreVersions: vi.fn(() => Promise.resolve([{ appStoreState: 'READY_FOR_SALE' }])),
    findEditableAppStoreVersion: vi.fn(() =>
      Promise.resolve({ id: 'ver-1', copyright: '2026 Acme' }),
    ),
    getAppStoreReviewDetail: vi.fn(() =>
      Promise.resolve({ attributes: { demoAccountRequired: false } }),
    ),
    listBundleIdCapabilities: vi.fn(() =>
      Promise.resolve([{ capabilityType: 'PUSH_NOTIFICATIONS' }]),
    ),
    listAppStoreVersionLocalizations: vi.fn(() =>
      Promise.resolve([{ id: 'loc-1', locale: 'en-US' }]),
    ),
    listScreenshotSets: vi.fn(() =>
      Promise.resolve([{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_67' }]),
    ),
    listScreenshots: vi.fn(() => Promise.resolve([{ id: 'shot-1' }])),
    ...overrides,
  };
};
/** A read-only Play fake, mirroring {@link ascApi}. */
const playApi = (overrides: Partial<PlayReadinessApi> = {}): PlayReadinessApi => {
  return {
    assertAppExists: vi.fn(() => Promise.resolve(undefined)),
    getLatestVersionCode: vi.fn(() => Promise.resolve(42)),
    listTracks: vi.fn(() => Promise.resolve([{ track: 'internal' }])),
    ...overrides,
  };
};
/** Build a context with explicit clients (or `null` to simulate unconfigured credentials). */
const createReadinessContext = (args: {
  apps: AppDescriptor[];
  asc?: AscReadinessApi | null;
  play?: PlayReadinessApi | null;
  products?: LaunchConfig['products'];
}): ReadinessContext => {
  let appleStore: AscReadinessApi | null = null;
  if (args.asc != null) appleStore = args.asc;
  let googleStore: PlayReadinessApi | null = null;
  if (args.play != null) googleStore = args.play;
  return {
    config: config(args.products),
    apps: args.apps,
    resolveAscApi: () => Promise.resolve(appleStore),
    resolvePlayApi: () => Promise.resolve(googleStore),
  };
};
/** The per-app status + identifier of a `checked` result (empty for any other state). */
const findings = (
  probeResult: ProbeResult,
): {
  status: string;
  identifier: string;
}[] => {
  if (probeResult.state != 'checked') return [];
  return probeResult.apps.map(({ status, identifier }) => ({ status, identifier }));
};

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
describe('appRecordProbe', () => {
  it('omits itself when no app has a bundle id', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probeResult = await checkProbe(appRecordProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  });
  it('skips when no Apple account is configured', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: null,
    });
    const probeResult = await checkProbe(appRecordProbe, createReadiness);
    expect(probeResult.state).toBe('skipped');
  });
  it("passes when the app record exists, blocks when it doesn't", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(appRecordProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const api = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const missing = await checkProbe(
      appRecordProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: api }),
    );
    expect(findings(missing)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(api.getAppId).toHaveBeenCalledWith('com.x');
  });
});
describe('agreementsProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it('passes when agreements are in effect, blocks when one is missing/expired (one account-wide finding)', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(agreementsProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'account-wide' }]);
    const missing = ascApi({
      checkRequiredAgreements: vi.fn(() => Promise.resolve(false)),
    });
    const blocked = await checkProbe(
      agreementsProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: missing }),
    );
    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'account-wide' }]);
  });
  it('propagates an unexpected read failure so the orchestrator records it as errored', async () => {
    const broken = ascApi({
      checkRequiredAgreements: vi.fn(() =>
        Promise.resolve(
          (() => {
            throw new Error('network down');
          })(),
        ),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: broken,
    });
    const probe = checkProbe(agreementsProbe, createReadiness);
    await expect(probe).rejects.toThrow('network down');
  });
});
describe('subscriptionGroupProbe', () => {
  const withSubs = {
    'com.x': { subscriptionGroups: [{ referenceName: 'g', localizations: [], subscriptions: [] }] },
  };
  it('omits itself when no app declares subscriptions', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(subscriptionGroupProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  });
  it('blocks when the declared group is absent and passes when present', async () => {
    const empty = ascApi({
      listSubscriptionGroups: vi.fn(() => Promise.resolve([])),
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
  });
  it("warns instead of blocking when the app record isn't there to check against", async () => {
    const api = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: api,
      products: withSubs,
    });
    const probeResult = await checkProbe(subscriptionGroupProbe, createReadiness);
    const listedFindings = findings(probeResult);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('iapProductsProbe', () => {
  const withIap: LaunchConfig['products'] = {
    'com.x': {
      inAppPurchases: [
        { productId: 'com.x.coins', referenceName: 'Coins', type: 'CONSUMABLE', localizations: [] },
      ],
    },
  };
  it('omits when no app declares one-time IAPs, skips without an Apple account', async () => {
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
  });
  it('passes a present product, blocks a missing one and a MISSING_METADATA one', async () => {
    const present = ascApi({
      listInAppPurchases: vi.fn(() =>
        Promise.resolve([{ productId: 'com.x.coins', state: 'READY_TO_SUBMIT' }]),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withIap,
    });
    const probe = await checkProbe(iapProductsProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.coins' }]);
    const absent = ascApi({
      listInAppPurchases: vi.fn(() => Promise.resolve([])),
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
    const incomplete = ascApi({
      listInAppPurchases: vi.fn(() =>
        Promise.resolve([{ productId: 'com.x.coins', state: 'MISSING_METADATA' }]),
      ),
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
  });
  it("warns instead of blocking when the app record isn't there to check against", async () => {
    const noApp = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
      products: withIap,
    });
    const probeResult = await checkProbe(iapProductsProbe, createReadiness);
    const listedFindings = findings(probeResult);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('subscriptionsProbe', () => {
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
  it('omits when no app declares subscriptions', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(subscriptionsProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  });
  it("passes a present subscription, blocks a missing one (across the app's groups)", async () => {
    const present = ascApi({
      listSubscriptions: vi.fn(() =>
        Promise.resolve([{ productId: 'com.x.pro', state: 'READY_TO_SUBMIT' }]),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withSub,
    });
    const probe = await checkProbe(subscriptionsProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.pro' }]);
    const absent = ascApi({
      listSubscriptions: vi.fn(() => Promise.resolve([])),
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
  });
});
describe('bundleIdProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it("passes when the Bundle ID is registered, blocks when it isn't", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(bundleIdProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const api = ascApi({
      findBundleId: vi.fn(() => Promise.resolve(null)),
    });
    const missing = await checkProbe(
      bundleIdProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: api }),
    );
    expect(findings(missing)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(api.findBundleId).toHaveBeenCalledWith('com.x');
  });
});
describe('distributionCertProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it('passes on an unexpired cert, blocks when none exist or all are expired (one team-wide finding)', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(distributionCertProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'team-wide' }]);
    const none = ascApi({
      listDistributionCertificates: vi.fn(() => Promise.resolve([])),
    });
    const blockedNone = await checkProbe(
      distributionCertProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: none }),
    );
    expect(findings(blockedNone)).toEqual([{ status: 'blocker', identifier: 'team-wide' }]);
    const expired = ascApi({
      listDistributionCertificates: vi.fn(() =>
        Promise.resolve([{ id: 'c1', expirationDate: '2000-01-01T00:00:00Z' }]),
      ),
    });
    const blockedExpired = await checkProbe(
      distributionCertProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: expired }),
    );
    expect(findings(blockedExpired)).toEqual([{ status: 'blocker', identifier: 'team-wide' }]);
  });
  it('treats a certificate with no recorded expiry as usable', async () => {
    const undated = ascApi({
      listDistributionCertificates: vi.fn(() => Promise.resolve([{ id: 'c1' }])),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: undated,
    });
    const ok = await checkProbe(distributionCertProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'team-wide' }]);
  });
});
describe('exportComplianceProbe', () => {
  it('omits when no app declares a bundle id', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ packageName: 'com.x' })] });
    const probe = await checkProbe(exportComplianceProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  });
  it('passes when declared (even `false`), warns when undeclared - needs no credentials', async () => {
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
  });
});
describe('playAppProbe', () => {
  it('passes when the app is reachable, blocks when Play rejects it', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playAppProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const denied = playApi({
      assertAppExists: vi.fn(() =>
        Promise.resolve(
          (() => {
            throw new Error('app not found');
          })(),
        ),
      ),
    });
    const blocked = await checkProbe(
      playAppProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: denied }),
    );
    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  });
});
describe('playFirstUploadProbe', () => {
  it('passes with an uploaded build, blocks at versionCode 0, warns on a read failure', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playFirstUploadProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const none = playApi({
      getLatestVersionCode: vi.fn(() => Promise.resolve(0)),
    });
    const blocked = await checkProbe(
      playFirstUploadProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: none }),
    );
    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    const broken = playApi({
      getLatestVersionCode: vi.fn(() =>
        Promise.resolve(
          (() => {
            throw new Error('nope');
          })(),
        ),
      ),
    });
    const warned = await checkProbe(
      playFirstUploadProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: broken }),
    );
    expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('playInternalTrackProbe', () => {
  it("passes when an internal track exists, warns when it doesn't", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ packageName: 'com.x' })],
      play: playApi(),
    });
    const ok = await checkProbe(playInternalTrackProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const noTrack = playApi({
      listTracks: vi.fn(() => Promise.resolve([{ track: 'production' }])),
    });
    const warned = await checkProbe(
      playInternalTrackProbe,
      createReadinessContext({ apps: [app({ packageName: 'com.x' })], play: noTrack }),
    );
    expect(findings(warned)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('iapPricingProbe', () => {
  it('omits when no app declares a priced product, skips without an Apple account', async () => {
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
  });
  it('passes a valid price point, blocks an invalid one', async () => {
    const live = [{ id: 'iap1', productId: 'com.x.coins', state: 'READY_TO_SUBMIT' }];
    const valid = ascApi({
      listInAppPurchases: vi.fn(() => Promise.resolve(live)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: valid,
      products: withPricedIap,
    });
    const probe = await checkProbe(iapPricingProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.coins' }]);
    const invalid = ascApi({
      listInAppPurchases: vi.fn(() => Promise.resolve(live)),
      findInAppPurchasePricePoint: vi.fn(() => Promise.resolve(null)),
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
  });
  it("warns when the product isn't on App Store Connect yet, and when there's no app record", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withPricedIap,
    });
    const notLive = await checkProbe(iapPricingProbe, createReadiness);
    const listedFindings = findings(notLive);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x.coins' }]);
    const noApp = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
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
  });
});
describe('subscriptionOffersProbe', () => {
  it('omits when no subscription declares offer codes, skips without an Apple account', async () => {
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
  });
  it('passes a present offer code, warns on a missing one', async () => {
    const live = [{ id: 's1', productId: 'com.x.pro', state: 'READY_TO_SUBMIT' }];
    const present = ascApi({
      listSubscriptions: vi.fn(() => Promise.resolve(live)),
      listSubscriptionOfferCodes: vi.fn(() => Promise.resolve([{ name: 'LAUNCH50' }])),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: present,
      products: withOffers,
    });
    const probe = await checkProbe(subscriptionOffersProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x.pro-LAUNCH50' }]);
    const missing = ascApi({
      listSubscriptions: vi.fn(() => Promise.resolve(live)),
      listSubscriptionOfferCodes: vi.fn(() => Promise.resolve([])),
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
  });
  it("warns (deferring to the subscriptions probe) when the subscription isn't on App Store Connect yet", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withOffers,
    });
    const probeResult = await checkProbe(subscriptionOffersProbe, createReadiness);
    const listedFindings = findings(probeResult);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x.pro' }]);
  });
});
describe('sandboxTestersProbe', () => {
  it('omits when no app sells products, skips without an Apple account', async () => {
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
  });
  it('passes with >=1 tester, warns with none (one account-wide finding)', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
      products: withPricedIap,
    });
    const ok = await checkProbe(sandboxTestersProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'account-wide' }]);
    const none = ascApi({
      listSandboxTesters: vi.fn(() => Promise.resolve([])),
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
  });
});
/** The first finding's `detail` string from a `checked` result (empty otherwise) - for asserting copy. */
const firstDetail = (probeResult: ProbeResult): string => {
  if (probeResult.state != 'checked') return '';
  const firstFinding = probeResult.apps[0];
  if (firstFinding == null) return '';
  return firstFinding.detail;
};
/** A products catalog declaring a single one-time IAP under `com.x`. */
const oneIap: LaunchConfig['products'] = {
  'com.x': {
    inAppPurchases: [
      { productId: 'com.x.coins', referenceName: 'Coins', type: 'CONSUMABLE', localizations: [] },
    ],
  },
};
describe('iapCodeReferenceProbe', () => {
  it('omits when the app declares no products (no scan)', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(iapCodeReferenceProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  });
  it("passes when every declared id appears in source, warns (naming it) when one doesn't", async () => {
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
  });
  it('does not scan node_modules - a reference there does not count as a real one', async () => {
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
  });
});
describe('storeKitConfigProbe', () => {
  it('omits when the app declares no products', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probeResult = await checkProbe(storeKitConfigProbe, createReadiness);
    expect(probeResult.state).toBe('omitted');
  });
  it('warns when no .storekit file exists, passes once one is added', async () => {
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
  });
});
describe('ageRatingProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it('passes a completed questionnaire, blocks an empty or never-touched one', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(ageRatingProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const empty = ascApi({
      getAgeRatingDeclaration: vi.fn(() => Promise.resolve({ attributes: {} })),
    });
    const probe = await checkProbe(
      ageRatingProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: empty }),
    );
    expect(findings(probe)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    const untouched = ascApi({
      getAgeRatingDeclaration: vi.fn(() => Promise.resolve(null)),
    });
    expect(
      findings(
        await checkProbe(
          ageRatingProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: untouched }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  });
  it("warns instead of blocking when there's no app record or no editable version to read", async () => {
    const noApp = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(ageRatingProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    const noInfo = ascApi({
      getEditableAppInfoId: vi.fn(() => Promise.resolve(null)),
    });
    expect(
      findings(
        await checkProbe(
          ageRatingProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noInfo }),
        ),
      ),
    ).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('accountDeletionProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it('passes when a URL is declared in any locale, warns when none is set', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(accountDeletionProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const none = ascApi({
      listAccountDeletionUrls: vi.fn(() => Promise.resolve([{ locale: 'en-US', url: '' }])),
    });
    const probe = await checkProbe(
      accountDeletionProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: none }),
    );
    expect(findings(probe)).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
  it("warns when there's no app record or no editable app info to read", async () => {
    const noApp = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(accountDeletionProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('demoAccountProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it("passes when sign-in isn't required, or when it is and a demo account is provided", async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const notRequired = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(notRequired);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const provided = ascApi({
      getAppStoreReviewDetail: vi.fn(() =>
        Promise.resolve({
          attributes: { demoAccountRequired: true, demoAccountName: 'review@x.example' },
        }),
      ),
    });
    const probe = await checkProbe(
      demoAccountProbe,
      createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: provided }),
    );
    expect(findings(probe)).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  });
  it('blocks when sign-in is required but no demo account name is set', async () => {
    const missing = ascApi({
      getAppStoreReviewDetail: vi.fn(() =>
        Promise.resolve({ attributes: { demoAccountRequired: true } }),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: missing,
    });
    const probe = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  });
  it('warns when App Review details, the app record, or an editable version are missing', async () => {
    const noDetail = ascApi({
      getAppStoreReviewDetail: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noDetail,
    });
    const probe = await checkProbe(demoAccountProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    const noVersion = ascApi({
      findEditableAppStoreVersion: vi.fn(() => Promise.resolve(null)),
    });
    expect(
      findings(
        await checkProbe(
          demoAccountProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noVersion }),
        ),
      ),
    ).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('profileEntitlementsProbe', () => {
  /** An app whose entitlements require the Push Notifications capability on its App ID. */
  const pushApp = app({ bundleId: 'com.x', iosEntitlements: { 'aps-environment': 'production' } });
  it('omits when no in-scope app declares capability-bearing entitlements', async () => {
    const createReadiness = createReadinessContext({ apps: [app({ bundleId: 'com.x' })] });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    expect(probe.state).toBe('omitted');
  });
  it('skips without an Apple account when an app does declare entitlements', async () => {
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: null });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    expect(probe.state).toBe('skipped');
  });
  it("passes when the App ID's capabilities cover the entitlements, blocks when one is missing", async () => {
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: ascApi() });
    const ok = await checkProbe(profileEntitlementsProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
    const missing = ascApi({
      listBundleIdCapabilities: vi.fn(() => Promise.resolve([])),
    });
    const blocked = await checkProbe(
      profileEntitlementsProbe,
      createReadinessContext({ apps: [pushApp], asc: missing }),
    );
    expect(findings(blocked)).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    expect(firstDetail(blocked)).toContain('PUSH_NOTIFICATIONS');
  });
  it("warns when the App ID isn't registered yet", async () => {
    const noBundle = ascApi({
      findBundleId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({ apps: [pushApp], asc: noBundle });
    const probe = await checkProbe(profileEntitlementsProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('screenshotsProbe', () => {
  it('omits without an iOS app and skips without an Apple account', async () => {
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
  });
  it('passes when the required 6.7" class has a screenshot', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  });
  it('warns when iPhone screenshots exist but not for the required class, blocks when none exist', async () => {
    const otherClass = ascApi({
      listScreenshotSets: vi.fn(() =>
        Promise.resolve([{ id: 'set-1', screenshotDisplayType: 'APP_IPHONE_65' }]),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: otherClass,
    });
    const probe = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    const noShots = ascApi({
      listScreenshots: vi.fn(() => Promise.resolve([])),
    });
    expect(
      findings(
        await checkProbe(
          screenshotsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noShots }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
    const noSets = ascApi({
      listScreenshotSets: vi.fn(() => Promise.resolve([])),
    });
    expect(
      findings(
        await checkProbe(
          screenshotsProbe,
          createReadinessContext({ apps: [app({ bundleId: 'com.x' })], asc: noSets }),
        ),
      ),
    ).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  });
  it("warns when there's no app record or no editable version to read", async () => {
    const noApp = ascApi({
      getAppId: vi.fn(() => Promise.resolve(null)),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: noApp,
    });
    const probe = await checkProbe(screenshotsProbe, createReadiness);
    const listedFindings = findings(probe);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
  });
});
describe('listingUrlsProbe', () => {
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
  it('omits when no in-scope app declares a listing URL', async () => {
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
  });
  it('passes a 2xx URL and blocks a non-2xx one', async () => {
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
  });
  it('propagates a fetch failure so the orchestrator records it as errored', async () => {
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
  });
});
describe('versionCopyrightProbe', () => {
  const emptyCopyright = ascApi({
    findEditableAppStoreVersion: vi.fn(() => Promise.resolve({ id: 'ver-1', copyright: '' })),
  });
  it('passes when the editable version has a copyright', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(versionCopyrightProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  });
  it('blocks when the editable version has an empty copyright', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: emptyCopyright,
    });
    const blocked = await checkProbe(versionCopyrightProbe, createReadiness);
    const listedFindings = findings(blocked);
    expect(listedFindings).toEqual([{ status: 'blocker', identifier: 'com.x' }]);
  });
  it('passes an empty copyright that release.copyright will fill', async () => {
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
  });
});
describe('appPrivacyProbe', () => {
  it('passes an app that has been released before', async () => {
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: ascApi(),
    });
    const ok = await checkProbe(appPrivacyProbe, createReadiness);
    const listedFindings = findings(ok);
    expect(listedFindings).toEqual([{ status: 'ok', identifier: 'com.x' }]);
  });
  it('lists App Privacy as a manual step for a first version', async () => {
    const firstVersionOnly = ascApi({
      listAppStoreVersions: vi.fn(() =>
        Promise.resolve([{ appStoreState: 'PREPARE_FOR_SUBMISSION' }]),
      ),
    });
    const createReadiness = createReadinessContext({
      apps: [app({ bundleId: 'com.x' })],
      asc: firstVersionOnly,
    });
    const firstVersion = await checkProbe(appPrivacyProbe, createReadiness);
    const listedFindings = findings(firstVersion);
    expect(listedFindings).toEqual([{ status: 'warn', identifier: 'com.x' }]);
    expect(firstVersionOnly.listAppStoreVersions).toHaveBeenCalledWith('app-1', 'IOS');
  });
});
