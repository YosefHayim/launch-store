import { Effect } from 'effect';
import type { StatsFeedPlugin } from '../../types/stats.js';

export const appStoreFeed: StatsFeedPlugin = {
  feed: 'app-store',
  isApplicable: (app) => app.platform === 'ios',
  fetchDays: () => Effect.succeed({ status: 'skipped', reason: 'not built yet' }),
};
