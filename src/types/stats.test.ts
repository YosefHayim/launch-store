import { describe, expect, test } from 'vitest';
import { STATS_FEED_PLUGINS } from '../stats/feedRegistry.js';
import { METRIC_AGGREGATION, STATS_FEEDS } from './stats.js';

describe('stats types', () => {
  test('STATS_FEEDS lists the same feeds as the plugin registry', () => {
    const registeredFeeds = STATS_FEED_PLUGINS.map((plugin) => plugin.feed);

    expect(STATS_FEEDS).toEqual(registeredFeeds);
  });

  test('every metric has a known way to add up days', () => {
    const aggregations = new Set(Object.values(METRIC_AGGREGATION));

    expect([...aggregations].sort()).toEqual(['average', 'latest', 'sum']);
  });
});
