import type { StatsFeedPlugin } from '../types/stats.js';
import { appStoreFeed } from './feeds/appStore.js';
import { ga4Feed } from './feeds/ga4.js';
import { googlePlayFeed } from './feeds/googlePlay.js';

export const STATS_FEED_PLUGINS: readonly StatsFeedPlugin[] = [
  appStoreFeed,
  googlePlayFeed,
  ga4Feed,
];
