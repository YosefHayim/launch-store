import { writeLaunchHomeFile } from './launch-home-testkit.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import type { DailyStat } from '../types/stats.ts';

const dayMilliseconds = 24 * 60 * 60 * 1000;

export const STATS_PORTFOLIO_FILE: PortfolioFile = {
  version: 1,
  discoveredAt: '2026-10-01T00:00:00.000Z',
  playReportsBucket: null,
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
export function readDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * dayMilliseconds).toISOString().slice(0, 10);
}

/** Write one month file per month the stats touch, as the stats store would. */
export function writeStatsMonthFiles(
  homeDirectory: string,
  appKey: string,
  stats: readonly DailyStat[],
): void {
  function readStatMonth(dailyStat: DailyStat) {
    return dailyStat.date.slice(0, 7);
  }

  const months = [...new Set(stats.map(readStatMonth))];

  for (const month of months) {
    function isStatInMonth(dailyStat: DailyStat) {
      return dailyStat.date.startsWith(month);
    }

    const monthStats = stats.filter(isStatInMonth);
    const serialized = JSON.stringify({ version: 1, appKey, month, stats: monthStats });

    writeLaunchHomeFile(homeDirectory, `stats/${appKey}/${month}.json`, serialized);
  }
}
