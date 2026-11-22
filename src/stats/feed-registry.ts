import type { StatsFeedPlugin } from '../types/stats.ts';
import { appStoreFeed } from './feeds/app-store.ts';
import { ga4Feed } from './feeds/ga4.ts';
import { googlePlayFeed } from './feeds/google-play.ts';

export const STATS_FEED_PLUGINS: readonly StatsFeedPlugin[] = [
  appStoreFeed,
  googlePlayFeed,
  ga4Feed,
];
