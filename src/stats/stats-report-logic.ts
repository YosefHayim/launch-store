import type {
  AppCoverage,
  DailyStat,
  DateRange,
  StatsFeed,
  StatsFreshness,
  StatsMetric,
} from '../types/stats.ts';
import { METRIC_AGGREGATION, STATS_FEEDS } from '../types/stats.ts';
import type { DailyPoint, MetricSeries, MetricTotal } from '../types/stats-report.ts';
import { findFeedCoverage } from './coverage-logic.ts';
import { readMonthOfDate, shiftDate } from './date-range.ts';
import type { AppFeedSyncReport } from '../types/stats.ts';

function listMonthsFrom(month: string, lastMonth: string): string[] {
  const isPastLastMonth = month > lastMonth;

  if (isPastLastMonth) return [];

  const safeDayToReachNextMonth = 4;
  const lastSafeDayOfAnyMonth = 28;
  const dayInNextMonth = shiftDate(`${month}-${lastSafeDayOfAnyMonth}`, safeDayToReachNextMonth);
  const monthOfDate = readMonthOfDate(dayInNextMonth);

  return [month, ...listMonthsFrom(monthOfDate, lastMonth)];
}

/** Every `YYYY-MM` month a date range touches, oldest first. */
export function listMonthsInRange(range: DateRange): string[] {
  const monthOfDate = readMonthOfDate(range.from);
  return listMonthsFrom(monthOfDate, readMonthOfDate(range.to));
}

/** Keep the stats whose day is inside the range, both ends included. */
export function keepStatsInRange(stats: readonly DailyStat[], range: DateRange): DailyStat[] {
  function filterStat(stat: DailyStat) {
    return stat.date >= range.from && stat.date <= range.to;
  }

  return stats.filter(filterStat);
}

interface StatGroup {
  readonly feed: StatsFeed;
  readonly metric: StatsMetric;
  readonly currency: string | null;
  readonly stats: readonly DailyStat[];
}

function createGroupIdentity(group: Omit<StatGroup, 'stats'>): string {
  return [group.feed, group.metric, group.currency].join('|');
}

interface KeyedMembers<Member> {
  readonly key: string;
  readonly members: readonly Member[];
}

function groupByKey<Member>(
  members: readonly Member[],
  readKey: (member: Member) => string,
): KeyedMembers<Member>[] {
  function sortFirst(first: string, second: string) {
    return first.localeCompare(second);
  }

  const keys = [...new Set(members.map(readKey))].sort(sortFirst);

  function mapKey(key: string) {
    function filterMember(member: Member) {
      return readKey(member) == key;
    }

    return { key, members: members.filter(filterMember) };
  }

  return keys.map(mapKey);
}
function flatMapIdentityGroup(identityGroup: KeyedMembers<DailyStat>) {
  function mapFirstStat(firstStat: DailyStat) {
    return {
      feed: firstStat.feed,
      metric: firstStat.metric,
      currency: firstStat.currency,
      stats: identityGroup.members,
    };
  }

  return identityGroup.members.slice(0, 1).map(mapFirstStat);
}

function groupStats(stats: readonly DailyStat[]): StatGroup[] {
  return groupByKey(stats, createGroupIdentity).flatMap(flatMapIdentityGroup);
}
function sortFirst2(first: DailyStat, second: DailyStat) {
  return first.date.localeCompare(second.date);
}

function sortByDate(stats: readonly DailyStat[]): DailyStat[] {
  return [...stats].sort(sortFirst2);
}
function reduceRunningTotal(runningTotal: number, stat: DailyStat) {
  return runningTotal + stat.value;
}

function sumAmounts(stats: readonly DailyStat[]): number {
  return stats.reduce(reduceRunningTotal, 0);
}

/** Fold the stats of one metric into a single number by the metric's rule: sum, latest or average. */
export function foldMetricStats(metric: StatsMetric, stats: readonly DailyStat[]): number {
  const aggregation = METRIC_AGGREGATION[metric];
  const sortedStats = sortByDate(stats);
  const latestStat = sortedStats[sortedStats.length - 1];

  const isLatestRule = aggregation == 'latest' && latestStat != null;

  if (isLatestRule) return latestStat.value;

  const isAverageRule = aggregation == 'average' && stats.length > 0;

  if (isAverageRule) return sumAmounts(stats) / stats.length;

  return sumAmounts(stats);
}
function readDate(stat: DailyStat) {
  return stat.date;
}
function mapGroup(group: StatGroup) {
  return {
    feed: group.feed,
    metric: group.metric,
    currency: group.currency,
    aggregation: METRIC_AGGREGATION[group.metric],
    total: foldMetricStats(group.metric, group.stats),
    dayCount: new Set(group.stats.map(readDate)).size,
  };
}

/** One total per feed, metric and currency. Proceeds of different currencies are never mixed. */
export function foldMetricTotals(stats: readonly DailyStat[]): MetricTotal[] {
  return groupStats(stats).map(mapGroup);
}
function mapStat(stat: DailyStat) {
  return { date: stat.date, amount: stat.value };
}
function mapGroup2(group: StatGroup) {
  return {
    feed: group.feed,
    metric: group.metric,
    currency: group.currency,
    points: sortByDate(group.stats).map(mapStat),
  };
}

/** One daily series per feed, metric and currency, oldest day first. */
export function createMetricSeries(stats: readonly DailyStat[]): MetricSeries[] {
  return groupStats(stats).map(mapGroup2);
}

/** The totals of the first metric in the list that has any, so Android installs stand in for downloads. */
export function pickHeadlineTotals(
  totals: readonly MetricTotal[],
  preferredMetrics: readonly StatsMetric[],
): MetricTotal[] {
  for (const metric of preferredMetrics) {
    function filterTotal(total: MetricTotal) {
      return total.metric == metric;
    }

    const metricTotals = totals.filter(filterTotal);

    const hasMetricTotals = metricTotals.length > 0;

    if (hasMetricTotals) return metricTotals;
  }

  return [];
}

/** One number for a headline: summed when the metric adds up, else the first feed's number. Null when absent. */
export function readHeadlineTotal(
  totals: readonly MetricTotal[],
  preferredMetrics: readonly StatsMetric[],
): number | null {
  const headlineTotals = pickHeadlineTotals(totals, preferredMetrics);
  const firstTotal = headlineTotals[0];

  if (firstTotal == null) return null;

  if (firstTotal.aggregation != 'sum') return firstTotal.total;

  function reduceRunningTotal2(runningTotal: number, total: MetricTotal) {
    return runningTotal + total.total;
  }

  return headlineTotals.reduce(reduceRunningTotal2, 0);
}
function filterTotal2(total: MetricTotal) {
  return total.metric == 'proceeds';
}

/** The proceeds totals, one per currency. */
export function listProceedsTotals(totals: readonly MetricTotal[]): MetricTotal[] {
  return totals.filter(filterTotal2);
}

/** One daily series for a headline: the first preferred metric that has points, feeds added per day. */
export function mergeHeadlinePoints(
  series: readonly MetricSeries[],
  preferredMetrics: readonly StatsMetric[],
): DailyPoint[] {
  for (const metric of preferredMetrics) {
    function filterOneSeries(oneSeries: MetricSeries) {
      return oneSeries.metric == metric && oneSeries.points.length > 0;
    }

    const metricSeries = series.filter(filterOneSeries);

    const hasMetricSeries = metricSeries.length > 0;

    if (!hasMetricSeries) continue;

    function readPoints(oneSeries: MetricSeries) {
      return oneSeries.points;
    }

    const allPoints = metricSeries.flatMap(readPoints);

    function groupByKeyPoint(point: DailyPoint) {
      return point.date;
    }

    function reduceRunningTotal3(runningTotal: number, point: DailyPoint) {
      return runningTotal + point.amount;
    }
    function mapDateGroup(dateGroup: KeyedMembers<DailyPoint>) {
      return {
        date: dateGroup.key,
        amount: dateGroup.members.reduce(reduceRunningTotal3, 0),
      };
    }

    return groupByKey(allPoints, groupByKeyPoint).map(mapDateGroup);
  }

  return [];
}

/** An app is stale when the sync could not run, or one of its own feeds failed. */
export function isAppStale(freshness: StatsFreshness, appKey: string): boolean {
  if (!freshness.isStale) return false;

  if (freshness.report == null) return true;

  function someAppFeed(appFeed: AppFeedSyncReport) {
    return appFeed.appKey == appKey && appFeed.status == 'failed';
  }

  return freshness.report.appFeeds.some(someAppFeed);
}

/** The error and note every feed saved at its last sync for one app, so a fresh cache still explains empty numbers. */
export function listAppMessages(appCoverage: AppCoverage): string[] {
  function flatMapFeed(feed: 'app-store' | 'google-play' | 'ga4') {
    const feedCoverage = findFeedCoverage(appCoverage, feed);

    const isFeedNeverSynced = feedCoverage == null;

    if (isFeedNeverSynced) return [];

    function filterMessage(message: string | null) {
      return message != null;
    }

    function mapMessage(message: string) {
      return `${feed}: ${message}`;
    }

    return [feedCoverage.lastError, feedCoverage.lastNote].filter(filterMessage).map(mapMessage);
  }

  return STATS_FEEDS.flatMap(flatMapFeed);
}
