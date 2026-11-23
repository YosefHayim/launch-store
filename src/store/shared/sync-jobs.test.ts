import { describe, expect, it } from 'vitest';
import { buildJobs, selectApps } from './sync-jobs.ts';
import type { AppDescriptor } from '@/types/app.js';
import type { AppProducts } from '@/types/catalog.js';
import type { LaunchConfig } from '@/types/config.js';

/** A discovered app pointing at a non-existent dir, so `buildJobs`' asset/listing reads return empty. */
function app(name: string, overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name,
    dir: `/no/such/dir/${name}`,
    configPath: `/no/such/dir/${name}/app.json`,
    ...overrides,
  };
}

/** A minimal valid Launch config. Only `products` matters to `buildJobs`. */
function config(products?: Record<string, AppProducts>): LaunchConfig {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  if (products == null) {
    return launchConfig;
  }

  return { ...launchConfig, products };
}

const IAP: AppProducts = {
  inAppPurchases: [
    {
      productId: 'com.acme.coins',
      referenceName: 'Coins',
      type: 'CONSUMABLE',
      localizations: [{ locale: 'en-US', name: 'Coins' }],
    },
  ],
};
function describeSelectApps() {
  const apps = [
    app('alpha', { bundleId: 'com.acme.alpha' }),
    app('beta'),
    app('gamma', { bundleId: 'com.acme.gamma' }),
  ];

  async function returnsEveryAppWhenNoSelectorIsGiven() {
    await expect(selectApps(apps, undefined)).resolves.toEqual(apps);
  }

  it('returns every app when no selector is given', returnsEveryAppWhenNoSelectorIsGiven);

  async function narrowsToTheNamedAppsInSelectorOrder() {
    const selectedApps = await selectApps(apps, 'gamma,alpha');

    expect(
      selectedApps.map(function selectedName(selectedApp) {
        return selectedApp.name;
      }),
    ).toEqual(['gamma', 'alpha']);
  }

  it('narrows to the named apps, in selector order', narrowsToTheNamedAppsInSelectorOrder);

  async function trimsWhitespaceAndIgnoresEmptyEntries() {
    const selectedApps = await selectApps(apps, ' alpha , ');

    expect(
      selectedApps.map(function selectedName(selectedApp) {
        return selectedApp.name;
      }),
    ).toEqual(['alpha']);
  }

  it('trims whitespace and ignores empty entries', trimsWhitespaceAndIgnoresEmptyEntries);

  async function failsWithTaggedPieceForAnUnknownAppName() {
    await expect(selectApps(apps, 'delta')).rejects.toMatchObject({
      _tag: 'AppSelectionFailure',
      appName: 'delta',
      discoveredApps: ['alpha', 'beta', 'gamma'],
    });
  }

  it('fails with tagged context for an unknown app name', failsWithTaggedPieceForAnUnknownAppName);
}

describe('selectApps', describeSelectApps);
function describeBuildJobs() {
  async function buildsAJobForAnAppThatDeclaresProducts() {
    const jobs = await buildJobs(
      [app('alpha', { bundleId: 'com.acme.alpha' })],
      config({ 'com.acme.alpha': IAP }),
    );

    expect(
      jobs.map(function jobBundle(job) {
        return job.bundleId;
      }),
    ).toEqual(['com.acme.alpha']);
    expect(jobs[0]?.products.inAppPurchases).toHaveLength(1);
  }

  it('builds a job for an app that declares products', buildsAJobForAnAppThatDeclaresProducts);

  async function skipsAnAppWithNoIOSBundleId() {
    const jobs = await buildJobs([app('beta')], config({ 'com.acme.beta': IAP }));
    expect(jobs).toHaveLength(0);
  }

  it('skips an app with no iOS bundle id', skipsAnAppWithNoIOSBundleId);

  async function skipsAnAppWithNothingToSyncNoCapabilitiesProductsListingOrAssets() {
    const jobs = await buildJobs([app('alpha', { bundleId: 'com.acme.alpha' })], config());
    expect(jobs).toHaveLength(0);
  }

  it(
    'skips an app with nothing to sync (no capabilities, products, listing, or assets)',
    skipsAnAppWithNothingToSyncNoCapabilitiesProductsListingOrAssets,
  );
}

describe('buildJobs', describeBuildJobs);
