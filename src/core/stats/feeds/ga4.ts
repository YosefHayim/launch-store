import { Effect } from 'effect';
import type { StatsFeedPlugin } from '../../types/stats.js';

export const ga4Feed: StatsFeedPlugin = {
  feed: 'ga4',
  isApplicable: () => true,
  fetchDays: () => Effect.succeed({ status: 'skipped', reason: 'not built yet' }),
};
