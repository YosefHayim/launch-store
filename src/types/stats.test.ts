import { describe, expect, test } from 'vitest';
import { STATS_FEED_PLUGINS } from '../stats/feed-registry.ts';
import { METRIC_AGGREGATION, STATS_FEEDS } from './stats.ts';
import type { StatsFeedPlugin } from './stats.ts';

function describeStatsTypes() {
  function sTATSFEEDSListsTheSameFeedsAsThePluginRegistry() {
    function readFeed(plugin: StatsFeedPlugin) {
      return plugin.feed;
    }

    const registeredFeeds = STATS_FEED_PLUGINS.map(readFeed);

    expect(STATS_FEEDS).toEqual(registeredFeeds);
  }

  test(
    'STATS_FEEDS lists the same feeds as the plugin registry',
    sTATSFEEDSListsTheSameFeedsAsThePluginRegistry,
  );
  function everyMetricHasAKnownWayToAddUpDays() {
    const ownValues = Object.values(METRIC_AGGREGATION);
    const aggregations = new Set(ownValues);

    expect([...aggregations].sort()).toEqual(['average', 'latest', 'sum']);
  }

  test('every metric has a known way to add up days', everyMetricHasAKnownWayToAddUpDays);
}

describe('stats types', describeStatsTypes);
