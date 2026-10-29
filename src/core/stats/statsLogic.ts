import type { DailyStat } from '../types/stats.js';
import { monthOfDate } from './dateRange.js';

const createStatIdentity = (stat: DailyStat): string =>
  [stat.date, stat.feed, stat.metric, stat.currency].join('|');

/** Merge by identity (date, feed, metric, currency): a new number replaces the saved one. Sorted. */
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

/** Split stats into one list per `YYYY-MM` month. */
export const groupStatsByMonth = (stats: readonly DailyStat[]): Map<string, DailyStat[]> => {
  const statsByMonth = new Map<string, DailyStat[]>();
  for (const stat of stats) {
    const month = monthOfDate(stat.date);
    const monthStats = statsByMonth.get(month);
    if (monthStats === undefined) statsByMonth.set(month, [stat]);
    if (monthStats !== undefined) monthStats.push(stat);
  }
  return statsByMonth;
};
