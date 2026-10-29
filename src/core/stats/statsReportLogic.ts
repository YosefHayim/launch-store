import type {
  AppCoverage,
  DailyStat,
  DateRange,
  StatsFeed,
  StatsFreshness,
  StatsMetric,
} from '../types/stats.js';
import { METRIC_AGGREGATION, STATS_FEEDS } from '../types/stats.js';
import type { DailyPoint, MetricSeries, MetricTotal } from '../types/statsReport.js';
import { findFeedCoverage } from './coverageLogic.js';
import { readMonthOfDate, shiftDate } from './dateRange.js';

const SAFE_DAY_TO_REACH_NEXT_MONTH = 4;
const LAST_SAFE_DAY_OF_ANY_MONTH = 28;

const listMonthsFrom = (month: string, lastMonth: string): string[] => {
  const isPastLastMonth = month > lastMonth;
  if (isPastLastMonth) return [];
  const dayInNextMonth = shiftDate(
    `${month}-${LAST_SAFE_DAY_OF_ANY_MONTH}`,
    SAFE_DAY_TO_REACH_NEXT_MONTH,
  );
  return [month, ...listMonthsFrom(readMonthOfDate(dayInNextMonth), lastMonth)];
};

/** Every `YYYY-MM` month a date range touches, oldest first. */
export const listMonthsInRange = (range: DateRange): string[] =>
  listMonthsFrom(readMonthOfDate(range.from), readMonthOfDate(range.to));

/** Keep the stats whose day is inside the range, both ends included. */
export const keepStatsInRange = (stats: readonly DailyStat[], range: DateRange): DailyStat[] =>
  stats.filter((stat) => stat.date >= range.from && stat.date <= range.to);

interface StatGroup {
  readonly feed: StatsFeed;
  readonly metric: StatsMetric;
  readonly currency: string | null;
  readonly stats: readonly DailyStat[];
}

const createGroupIdentity = (group: Omit<StatGroup, 'stats'>): string =>
  [group.feed, group.metric, group.currency].join('|');

interface KeyedMembers<Member> {
  readonly key: string;
  readonly members: readonly Member[];
}

const groupByKey = <Member>(
  members: readonly Member[],
  readKey: (member: Member) => string,
): KeyedMembers<Member>[] => {
  const keys = [...new Set(members.map(readKey))].sort((first, second) =>
    first.localeCompare(second),
  );
  return keys.map((key) => ({ key, members: members.filter((member) => readKey(member) === key) }));
};

const groupStats = (stats: readonly DailyStat[]): StatGroup[] =>
  groupByKey(stats, createGroupIdentity).flatMap((identityGroup) =>
    identityGroup.members.slice(0, 1).map((firstStat) => ({
      feed: firstStat.feed,
      metric: firstStat.metric,
      currency: firstStat.currency,
      stats: identityGroup.members,
    })),
  );

const sortByDate = (stats: readonly DailyStat[]): DailyStat[] =>
  [...stats].sort((first, second) => first.date.localeCompare(second.date));

const sumAmounts = (stats: readonly DailyStat[]): number =>
  stats.reduce((runningTotal, stat) => runningTotal + stat.value, 0);

/** Fold the stats of one metric into a single number by the metric's rule: sum, latest or average. */
export const foldMetricStats = (metric: StatsMetric, stats: readonly DailyStat[]): number => {
  const aggregation = METRIC_AGGREGATION[metric];
  const sortedStats = sortByDate(stats);
  const latestStat = sortedStats[sortedStats.length - 1];
  const isLatestRule = aggregation === 'latest' && latestStat !== undefined;
  if (isLatestRule) return latestStat.value;
  const isAverageRule = aggregation === 'average' && stats.length > 0;
  if (isAverageRule) return sumAmounts(stats) / stats.length;
  return sumAmounts(stats);
};

/** One total per feed, metric and currency. Proceeds of different currencies are never mixed. */
export const foldMetricTotals = (stats: readonly DailyStat[]): MetricTotal[] =>
  groupStats(stats).map((group) => ({
    feed: group.feed,
    metric: group.metric,
    currency: group.currency,
    aggregation: METRIC_AGGREGATION[group.metric],
    total: foldMetricStats(group.metric, group.stats),
    dayCount: new Set(group.stats.map((stat) => stat.date)).size,
  }));

/** One daily series per feed, metric and currency, oldest day first. */
export const createMetricSeries = (stats: readonly DailyStat[]): MetricSeries[] =>
  groupStats(stats).map((group) => ({
    feed: group.feed,
    metric: group.metric,
    currency: group.currency,
    points: sortByDate(group.stats).map((stat) => ({ date: stat.date, amount: stat.value })),
  }));

/** The totals of the first metric in the list that has any, so Android installs stand in for downloads. */
export const pickHeadlineTotals = (
  totals: readonly MetricTotal[],
  preferredMetrics: readonly StatsMetric[],
): MetricTotal[] => {
  for (const metric of preferredMetrics) {
    const metricTotals = totals.filter((total) => total.metric === metric);
    const hasMetricTotals = metricTotals.length > 0;
    if (hasMetricTotals) return metricTotals;
  }
  return [];
};

/** One number for a headline: summed when the metric adds up, else the first feed's number. Null when absent. */
export const readHeadlineTotal = (
  totals: readonly MetricTotal[],
  preferredMetrics: readonly StatsMetric[],
): number | null => {
  const headlineTotals = pickHeadlineTotals(totals, preferredMetrics);
  const firstTotal = headlineTotals[0];
  if (firstTotal === undefined) return null;
  if (firstTotal.aggregation !== 'sum') return firstTotal.total;
  return headlineTotals.reduce((runningTotal, total) => runningTotal + total.total, 0);
};

/** The proceeds totals, one per currency. */
export const listProceedsTotals = (totals: readonly MetricTotal[]): MetricTotal[] =>
  totals.filter((total) => total.metric === 'proceeds');

/** One daily series for a headline: the first preferred metric that has points, feeds added per day. */
export const mergeHeadlinePoints = (
  series: readonly MetricSeries[],
  preferredMetrics: readonly StatsMetric[],
): DailyPoint[] => {
  for (const metric of preferredMetrics) {
    const metricSeries = series.filter(
      (oneSeries) => oneSeries.metric === metric && oneSeries.points.length > 0,
    );
    const hasMetricSeries = metricSeries.length > 0;
    if (!hasMetricSeries) continue;
    const allPoints = metricSeries.flatMap((oneSeries) => oneSeries.points);
    return groupByKey(allPoints, (point) => point.date).map((dateGroup) => ({
      date: dateGroup.key,
      amount: dateGroup.members.reduce((runningTotal, point) => runningTotal + point.amount, 0),
    }));
  }
  return [];
};

/** An app is stale when the sync could not run, or one of its own feeds failed. */
export const isAppStale = (freshness: StatsFreshness, appKey: string): boolean => {
  if (!freshness.isStale) return false;
  if (freshness.report === null) return true;
  return freshness.report.appFeeds.some(
    (appFeed) => appFeed.appKey === appKey && appFeed.status === 'failed',
  );
};

/** The error and note every feed saved at its last sync for one app, so a fresh cache still explains empty numbers. */
export const listAppMessages = (appCoverage: AppCoverage): string[] =>
  STATS_FEEDS.flatMap((feed) => {
    const feedCoverage = findFeedCoverage(appCoverage, feed);
    const isFeedNeverSynced = feedCoverage === null;
    if (isFeedNeverSynced) return [];
    return [feedCoverage.lastError, feedCoverage.lastNote]
      .filter((message) => message !== null)
      .map((message) => `${feed}: ${message}`);
  });
