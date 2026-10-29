import { Effect } from 'effect';
import type { StatsFeedPlugin } from '../../types/stats.js';

export const googlePlayFeed: StatsFeedPlugin = {
  feed: 'google-play',
  isApplicable: (app) => app.platform === 'android',
  fetchDays: () => Effect.succeed({ status: 'skipped', reason: 'not built yet' }),
};
