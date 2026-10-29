import { writeLaunchHomeFile } from '@testkit/launchHome.testkit.js';
import type { PortfolioFile } from '../core/types/portfolio.js';
import type { DailyStat } from '../core/types/stats.js';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export const STATS_PORTFOLIO_FILE: PortfolioFile = {
  version: 1,
  discoveredAt: '2026-10-01T00:00:00.000Z',
  apps: [
    {
      key: 'ios-1',
      platform: 'ios',
      storeId: '1',
      name: 'Cal Friend AI',
      bundleId: null,
      packageName: null,
      accountKeyId: 'KEYA',
      accountLabel: 'alpha',
    },
    {
      key: 'android-com.fit',
      platform: 'android',
      storeId: 'com.fit',
      name: 'Fit <Tracker>',
      bundleId: null,
      packageName: 'com.fit',
      accountKeyId: null,
      accountLabel: 'google-play',
    },
  ],
  tags: [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }],
};

/** A `YYYY-MM-DD` date some whole days before now, in UTC. */
export const readDateDaysAgo = (dayCount: number): string =>
  new Date(Date.now() - dayCount * DAY_MILLISECONDS).toISOString().slice(0, 10);

/** Write one month file per month the stats touch, as the stats store would. */
export const writeStatsMonthFiles = (
  homeDirectory: string,
  appKey: string,
  stats: readonly DailyStat[],
): void => {
  const months = [...new Set(stats.map((dailyStat) => dailyStat.date.slice(0, 7)))];
  for (const month of months) {
    const monthStats = stats.filter((dailyStat) => dailyStat.date.startsWith(month));
    writeLaunchHomeFile(
      homeDirectory,
      `stats/${appKey}/${month}.json`,
      JSON.stringify({ version: 1, appKey, month, stats: monthStats }),
    );
  }
};
