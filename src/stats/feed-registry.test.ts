import { afterEach, describe, expect, test } from 'vitest';
import type { PortfolioApp } from '../types/portfolio.ts';
import { STATS_FEED_PLUGINS } from './feed-registry.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';
import type { StatsFeedPlugin } from '../types/stats.ts';

function makeApp(platform: 'ios' | 'android'): PortfolioApp {
  return {
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
  };
}
function cleanup() {
  useStatsCredentials(null);
}

afterEach(cleanup);
function describeSTATSFEEDPLUGINS() {
  function listsTheThreeFeedsInOrder() {
    function readFeed(plugin: StatsFeedPlugin) {
      return plugin.feed;
    }

    expect(STATS_FEED_PLUGINS.map(readFeed)).toEqual(['app-store', 'google-play', 'ga4']);
  }

  test('lists the three feeds in order', listsTheThreeFeedsInOrder);

  function appliesEachStoreFeedToItsOwnPlatformAndGa4ToBoth() {
    function readFeed2(plugin: StatsFeedPlugin) {
      return plugin.feed;
    }

    function applicable(platform: 'ios' | 'android') {
      function isApplicableToPlatform(plugin: StatsFeedPlugin) {
        return plugin.isApplicable(makeApp(platform));
      }

      return STATS_FEED_PLUGINS.filter(isApplicableToPlatform).map(readFeed2);
    }

    expect(applicable('ios')).toEqual(['app-store', 'ga4']);
    expect(applicable('android')).toEqual(['google-play', 'ga4']);
  }

  test(
    'applies each store feed to its own platform and ga4 to both',
    appliesEachStoreFeedToItsOwnPlatformAndGa4ToBoth,
  );

  async function everyFeedSkipsWithAReasonWhenNothingIsSaved() {
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
        reason: 'No Google service account saved; add one with launch-store credentials',
      },
    ]);
  }

  test(
    'every feed skips with a reason when nothing is saved',
    everyFeedSkipsWithAReasonWhenNothingIsSaved,
  );
}

describe('STATS_FEED_PLUGINS', describeSTATSFEEDPLUGINS);
