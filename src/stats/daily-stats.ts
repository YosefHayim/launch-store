// Merges newly pulled daily stats over the days Launch already saved.

import type { DailyStat } from '../types/stats.ts';
import { readMonthOfDate } from './date-range.ts';

function createStatIdentity(stat: DailyStat): string {
  return [stat.date, stat.feed, stat.metric, stat.currency].join('|');
}

export function mergeStats(
  savedStats: readonly DailyStat[],
  newStats: readonly DailyStat[],
): DailyStat[] {
  const statsByIdentity = new Map<string, DailyStat>();

  for (const stat of savedStats) {
    const statIdentity = createStatIdentity(stat);
    statsByIdentity.set(statIdentity, stat);
  }
  for (const stat of newStats) {
    const statIdentity = createStatIdentity(stat);
    statsByIdentity.set(statIdentity, stat);
  }

  function sortPiece([firstIdentity]: [string, DailyStat], [secondIdentity]: [string, DailyStat]) {
    return firstIdentity.localeCompare(secondIdentity);
  }

  function copyDailyStat([, stat]: [string, DailyStat]) {
    return stat;
  }

  return [...statsByIdentity.entries()].sort(sortPiece).map(copyDailyStat);
}

export function groupStatsByMonth(stats: readonly DailyStat[]): Map<string, DailyStat[]> {
  const statsByMonth = new Map<string, DailyStat[]>();

  for (const stat of stats) {
    const month = readMonthOfDate(stat.date);
    const monthStats = statsByMonth.get(month);

    const isMonthNew = monthStats == null;

    if (isMonthNew) statsByMonth.set(month, [stat]);

    if (!isMonthNew) monthStats.push(stat);
  }

  return statsByMonth;
}
