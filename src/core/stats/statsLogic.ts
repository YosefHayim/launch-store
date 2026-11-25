import type { DailyStat } from '../types/stats.js';
import { readMonthOfDate } from './dateRange.js';

const createStatIdentity = (stat: DailyStat): string =>
  [stat.date, stat.feed, stat.metric, stat.currency].join('|');

export const mergeStats = (
  savedStats: readonly DailyStat[],
  newStats: readonly DailyStat[],
): DailyStat[] => {
  const statsByIdentity = new Map<string, DailyStat>();
  for (const stat of savedStats) statsByIdentity.set(createStatIdentity(stat), stat);
  for (const stat of newStats) statsByIdentity.set(createStatIdentity(stat), stat);
  return [...statsByIdentity.entries()]
    .sort(([firstIdentity], [secondIdentity]) => firstIdentity.localeCompare(secondIdentity))
    .map(([, stat]) => stat);
};

export const groupStatsByMonth = (stats: readonly DailyStat[]): Map<string, DailyStat[]> => {
  const statsByMonth = new Map<string, DailyStat[]>();
  for (const stat of stats) {
    const month = readMonthOfDate(stat.date);
    const monthStats = statsByMonth.get(month);
    const isMonthNew = monthStats === undefined;
    if (isMonthNew) statsByMonth.set(month, [stat]);
    if (!isMonthNew) monthStats.push(stat);
  }
  return statsByMonth;
};
