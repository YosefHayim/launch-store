import { describe, expect, it } from 'vitest';
import type { AdoptCatalogApi, AdoptTarget } from '../types/adopt.ts';
import type { AppDescriptor } from '../types/app.ts';
import { capabilitiesAdopter, NEEDS_VALUE, planCapabilityEntitlements } from './capabilities.ts';

function ready<Value>(value: Value): Promise<Value> {
  return Promise.resolve(value);
}

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

    if (first == null) {
      return;
    }

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

    if (first == null) {
      return;
    }

    expect(first.key).toBe('com.apple.developer.icloud-container-identifiers');
    expect(first.note).toContain('settings: ICLOUD_VERSION=VERSION_2');
  });
});

function emptyAdoptCatalog(overrides: Partial<AdoptCatalogApi> = {}): AdoptCatalogApi {
  const baseCatalog = {
    getAppId() {
      return ready('app1');
    },
    getLatestMarketingVersion() {
      return ready(null);
    },
    getLatestBuildNumber() {
      return ready(0);
    },
    findBundleId() {
      return ready({ id: 'b1', identifier: 'com.acme.app' });
    },
    listBundleIdCapabilities() {
      return ready([]);
    },
    listProfilesForBundleId() {
      return ready([]);
    },
    listMerchantIds() {
      return ready([]);
    },
    listInAppPurchases() {
      return ready([]);
    },
    listInAppPurchaseLocalizations() {
      return ready([]);
    },
    inAppPurchaseHasPrice() {
      return ready(false);
    },
    listSubscriptionGroups() {
      return ready([]);
    },
    listSubscriptionGroupLocalizations() {
      return ready([]);
    },
    listSubscriptions() {
      return ready([]);
    },
    listSubscriptionLocalizations() {
      return ready([]);
    },
    subscriptionHasPrice() {
      return ready(false);
    },
    listDistributionCertificates() {
      return ready([]);
    },
  };

  return { ...baseCatalog, ...overrides } as AdoptCatalogApi;
}

const acmeApp: AppDescriptor = {
  name: 'acme',
  dir: '/repo/acme',
  configPath: '/repo/acme/app.json',
  bundleId: 'com.acme.app',
};

const TARGET: AdoptTarget = {
  app: acmeApp,
  appId: 'app1',
  bundleId: 'com.acme.app',
  keyId: 'K',
  cwd: '/repo',
  hasLaunchConfig: false,
};

describe('capabilitiesAdopter', () => {
  it("returns no writes when the bundle id isn't registered yet", async () => {
    const appleCatalog = emptyAdoptCatalog({
      findBundleId() {
        return ready(null);
      },
    });
    expect(await capabilitiesAdopter.read(appleCatalog, TARGET)).toEqual([]);
  });

  it('plans app.json entitlement writes for enabled capabilities with no profile to read', async () => {
    const appleCatalog = emptyAdoptCatalog({
      listBundleIdCapabilities() {
        return ready([{ id: 'c1', capabilityType: 'PUSH_NOTIFICATIONS' }]);
      },
      listProfilesForBundleId() {
        return ready([]);
      },
    });
    const writes = await capabilitiesAdopter.read(appleCatalog, TARGET);
    expect(writes).toHaveLength(1);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();

    if (firstWrite == null) {
      return;
    }

    expect(firstWrite.change).toEqual({
      home: 'app.json',
      configPath: '/repo/acme/app.json',
      key: 'aps-environment',
      value: NEEDS_VALUE,
    });
    expect(firstWrite.fidelity).toBe('advisory');
  });
});
