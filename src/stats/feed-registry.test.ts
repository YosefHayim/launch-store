import { afterEach, describe, expect, test } from 'vitest';
import type { PortfolioApp } from '../types/portfolio.ts';
import { STATS_FEED_PLUGINS } from './feed-registry.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';

const makeApp = (platform: 'ios' | 'android'): PortfolioApp => ({
  key: `${platform}-1`,
  platform,
  storeId: '1',
  name: 'App',
  bundleId: null,
  packageName: null,
  accountKeyId: null,
  accountLabel: 'alpha',
  owner: null,
  ga4PropertyId: null,
});

afterEach(() => {
  useStatsCredentials(null);
});

describe('STATS_FEED_PLUGINS', () => {
  test('lists the three feeds in order', () => {
    expect(STATS_FEED_PLUGINS.map((plugin) => plugin.feed)).toEqual([
      'app-store',
      'google-play',
      'ga4',
    ]);
  });

  test('applies each store feed to its own platform and ga4 to both', () => {
    const applicable = (platform: 'ios' | 'android') =>
      STATS_FEED_PLUGINS.filter((plugin) => {
        return plugin.isApplicable(makeApp(platform));
      }).map((plugin) => plugin.feed);

    expect(applicable('ios')).toEqual(['app-store', 'ga4']);
    expect(applicable('android')).toEqual(['google-play', 'ga4']);
  });

  test('every feed skips with a reason when nothing is saved', async () => {
    const credentials = makeStatsCredentialsTest();

    async function fetchSkipped(plugin: (typeof STATS_FEED_PLUGINS)[number]) {
      return plugin.fetchDays({
        app: makeApp('ios'),
        range: { from: '2026-10-01', to: '2026-10-02' },
        credentials,
      });
    }

    const replies = await Promise.all(STATS_FEED_PLUGINS.map(fetchSkipped));

    expect(replies).toEqual([
      { status: 'skipped', reason: 'App has no App Store Connect account' },
      { status: 'skipped', reason: 'App has no package name' },
      {
        status: 'skipped',
        reason: 'No Google service account saved; add one with launch credentials',
      },
    ]);
  });
});
