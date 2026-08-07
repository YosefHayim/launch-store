import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AdoptCatalogApi, AdoptTarget } from '../types/adopt.js';
import type { AppDescriptor } from '../types/app.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { capabilitiesAdopter, NEEDS_VALUE, planCapabilityEntitlements } from './capabilities.js';

describe('planCapabilityEntitlements', () => {
  it('recovers a real identifier value from the provisioning profile', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['APP_GROUPS'],
      settingsByType: {},
      profileEntitlements: { 'com.apple.security.application-groups': ['group.com.acme'] },
      existing: {},
    });
    expect(planned).toEqual([
      { key: 'com.apple.security.application-groups', value: ['group.com.acme'] },
    ]);
  });

  it('flags an enabled capability with NEEDS_VALUE and an off-Mac note when no profile is available', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['APP_GROUPS'],
      settingsByType: {},
      profileEntitlements: null,
      existing: {},
    });
    const first = planned[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.value).toBe(NEEDS_VALUE);
    expect(first.note).toMatch(/off-Mac or none/);
  });

  it('flags an enabled capability the profile omits with a profile-gap note', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['PUSH_NOTIFICATIONS'],
      settingsByType: {},
      profileEntitlements: {},
      existing: {},
    });
    expect(planned).toEqual([
      {
        key: 'aps-environment',
        value: NEEDS_VALUE,
        note: 'enabled on App Store Connect but no value in the provisioning profile',
      },
    ]);
  });

  it('never overwrites an entitlement the app.json already declares', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['APP_GROUPS'],
      settingsByType: {},
      profileEntitlements: { 'com.apple.security.application-groups': ['group.com.acme'] },
      existing: { 'com.apple.security.application-groups': ['group.existing'] },
    });
    expect(planned).toEqual([]);
  });

  it('ignores always-on capabilities that carry no entitlement', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['IN_APP_PURCHASE', 'GAME_CENTER'],
      settingsByType: {},
      profileEntitlements: {},
      existing: {},
    });
    expect(planned).toEqual([]);
  });

  it('appends capability settings to a NEEDS_VALUE note as advisory detail', () => {
    const planned = planCapabilityEntitlements({
      enabledTypes: ['ICLOUD'],
      settingsByType: { ICLOUD: [{ key: 'ICLOUD_VERSION', options: [{ key: 'VERSION_2' }] }] },
      profileEntitlements: {},
      existing: {},
    });
    const first = planned[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.key).toBe('com.apple.developer.icloud-container-identifiers');
    expect(first.note).toContain('settings: ICLOUD_VERSION=VERSION_2');
  });
});

const emptyAdoptCatalog = (overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi => {
  const baseCatalog: AdoptCatalogApi = {
    getAppId: () => Effect.succeed('app1'),
    getLatestMarketingVersion: () => Effect.succeed(null),
    getLatestBuildNumber: () => Effect.succeed(0),
    findBundleId: () => Effect.succeed({ id: 'b1', identifier: 'com.acme.app' }),
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
  return { ...baseCatalog, ...overrides };
};

const APP: AppDescriptor = {
  name: 'acme',
  dir: '/repo/acme',
  configPath: '/repo/acme/app.json',
  bundleId: 'com.acme.app',
};

const TARGET: AdoptTarget = {
  app: APP,
  appId: 'app1',
  bundleId: 'com.acme.app',
  keyId: 'K',
  cwd: '/repo',
  hasLaunchConfig: false,
};

/** Run the capability adopter with platform command services available. */
const runCapabilitiesAdopter = (appleCatalog: AdoptCatalogApi) =>
  Effect.runPromise(
    capabilitiesAdopter
      .read(appleCatalog, TARGET)
      .pipe(Effect.provide(NodeContext.layer), Effect.provide(makeLaunchEnvironmentTest({}))),
  );

describe('capabilitiesAdopter', () => {
  it("returns no writes when the bundle id isn't registered yet", async () => {
    const appleCatalog = emptyAdoptCatalog({ findBundleId: () => Effect.succeed(null) });
    expect(await runCapabilitiesAdopter(appleCatalog)).toEqual([]);
  });

  it('plans app.json entitlement writes for enabled capabilities with no profile to read', async () => {
    const appleCatalog = emptyAdoptCatalog({
      listBundleIdCapabilities: () =>
        Effect.succeed([{ id: 'c1', capabilityType: 'PUSH_NOTIFICATIONS' }]),
      listProfilesForBundleId: () => Effect.succeed([]),
    });
    const writes = await runCapabilitiesAdopter(appleCatalog);
    expect(writes).toHaveLength(1);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.change).toEqual({
      home: 'app.json',
      configPath: '/repo/acme/app.json',
      key: 'aps-environment',
      value: NEEDS_VALUE,
    });
    expect(firstWrite.fidelity).toBe('advisory');
  });
});
