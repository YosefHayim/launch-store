import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { buildJobs, selectApps } from './syncJobs.js';
import type { AppDescriptor } from '../types/app.js';
import type { AppProducts } from '../types/catalog.js';
import type { LaunchConfig } from '../types/config.js';
/** A discovered app pointing at a non-existent dir, so `buildJobs`' asset/listing reads return empty. */
const app = (name: string, overrides: Partial<AppDescriptor> = {}): AppDescriptor => {
  return {
    name,
    dir: `/no/such/dir/${name}`,
    configPath: `/no/such/dir/${name}/app.json`,
    ...overrides,
  };
};
/** A minimal valid {@link LaunchConfig} - only `products` matters to `buildJobs`. */
const config = (products?: Record<string, AppProducts>): LaunchConfig => {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  if (products === undefined) return launchConfig;
  return { ...launchConfig, products };
};
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
const runBuildJobs = (apps: AppDescriptor[], launchConfig: LaunchConfig) =>
  Effect.runPromise(buildJobs(apps, launchConfig).pipe(Effect.provide(NodeContext.layer)));
describe('selectApps', () => {
  const apps = [
    app('alpha', { bundleId: 'com.acme.alpha' }),
    app('beta'),
    app('gamma', { bundleId: 'com.acme.gamma' }),
  ];
  it('returns every app when no selector is given', async () => {
    await expect(Effect.runPromise(selectApps(apps, undefined))).resolves.toEqual(apps);
  });
  it('narrows to the named apps, in selector order', async () => {
    const selectedApps = await Effect.runPromise(selectApps(apps, 'gamma,alpha'));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['gamma', 'alpha']);
  });
  it('trims whitespace and ignores empty entries', async () => {
    const selectedApps = await Effect.runPromise(selectApps(apps, ' alpha , '));
    expect(selectedApps.map((selectedApp) => selectedApp.name)).toEqual(['alpha']);
  });
  it('fails with tagged context for an unknown app name', async () => {
    const selectionFailure = await Effect.runPromise(Effect.flip(selectApps(apps, 'delta')));
    expect(selectionFailure).toMatchObject({
      _tag: 'AppSelectionFailure',
      appName: 'delta',
      discoveredApps: ['alpha', 'beta', 'gamma'],
    });
  });
});
describe('buildJobs', () => {
  it('builds a job for an app that declares products', async () => {
    const jobs = await runBuildJobs(
      [app('alpha', { bundleId: 'com.acme.alpha' })],
      config({ 'com.acme.alpha': IAP }),
    );
    expect(jobs.map((job) => job.bundleId)).toEqual(['com.acme.alpha']);
    expect(jobs[0]?.products.inAppPurchases).toHaveLength(1);
  });
  it('skips an app with no iOS bundle id', async () => {
    expect(await runBuildJobs([app('beta')], config({ 'com.acme.beta': IAP }))).toHaveLength(0);
  });
  it('skips an app with nothing to sync (no capabilities, products, listing, or assets)', async () => {
    expect(
      await runBuildJobs([app('alpha', { bundleId: 'com.acme.alpha' })], config()),
    ).toHaveLength(0);
  });
});
