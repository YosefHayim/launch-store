import type { DailyStat } from '../types/stats.ts';
import { readMonthOfDate } from './date-range.ts';

const createStatIdentity = (stat: DailyStat): string =>
  [stat.date, stat.feed, stat.metric, stat.currency].join('|');

export const mergeStats = (
  savedStats: readonly DailyStat[],
  newStats: readonly DailyStat[],
): DailyStat[] => {
  const statsByIdentity = new Map<string, DailyStat>();
  for (const stat of savedStats) {
    const statIdentity = createStatIdentity(stat);
    statsByIdentity.set(statIdentity, stat);
  }
  for (const stat of newStats) {
    const statIdentity = createStatIdentity(stat);
    statsByIdentity.set(statIdentity, stat);
  }
  return [...statsByIdentity.entries()]
    .sort(([firstIdentity], [secondIdentity]) => firstIdentity.localeCompare(secondIdentity))
    .map(([, stat]) => stat);
};

export const groupStatsByMonth = (stats: readonly DailyStat[]): Map<string, DailyStat[]> => {
  const statsByMonth = new Map<string, DailyStat[]>();
  for (const stat of stats) {
    const month = readMonthOfDate(stat.date);
    const monthStats = statsByMonth.get(month);
    const isMonthNew = monthStats == null;
    if (isMonthNew) statsByMonth.set(month, [stat]);
    if (!isMonthNew) monthStats.push(stat);
  }
  return statsByMonth;
};
