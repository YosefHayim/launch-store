import type { StatsMetric } from '../types/stats.js';
import type { AppStatsReport, MetricTotal } from '../types/statsReport.js';
import { listProceedsTotals, pickHeadlineTotals, readHeadlineTotal } from './statsReportLogic.js';

export const DOWNLOAD_METRICS: readonly StatsMetric[] = ['downloads', 'installs'];
export const USAGE_METRICS: readonly StatsMetric[] = ['sessions', 'activeUsers'];
const CRASH_METRICS: readonly StatsMetric[] = ['crashRate'];
const RATING_METRICS: readonly StatsMetric[] = ['ratingAverage'];

const LABEL_WIDTH = 14;
const NO_NUMBER_TEXT = '-';
const PERCENT_FACTOR = 100;
const MONEY_DECIMALS = 2;
const RATING_DECIMALS = 2;
const CRASH_RATE_DECIMALS = 2;
const COUNT_MAXIMUM_DECIMALS = 1;

/** A count with thousands separators, or a dash when the feed gave no number. */
export const describeCount = (count: number | null): string => {
  if (count === null) return NO_NUMBER_TEXT;
  return count.toLocaleString('en-US', { maximumFractionDigits: COUNT_MAXIMUM_DECIMALS });
};

/** Proceeds as `USD 56.20, EUR 10.00`, one part per currency, or a dash when there are none. */
export const describeProceeds = (totals: readonly MetricTotal[]): string => {
  const proceedsTotals = listProceedsTotals(totals);
  const hasNoProceeds = proceedsTotals.length === 0;
  if (hasNoProceeds) return NO_NUMBER_TEXT;
  return proceedsTotals
    .map((total) => `${total.currency} ${total.total.toFixed(MONEY_DECIMALS)}`)
    .join(', ');
};

/** A stored crash rate (a fraction) as a percent, or a dash. */
export const describeCrashRate = (crashRate: number | null): string => {
  if (crashRate === null) return NO_NUMBER_TEXT;
  return `${(crashRate * PERCENT_FACTOR).toFixed(CRASH_RATE_DECIMALS)}%`;
};

/** A rating average, or a dash. */
export const describeRating = (ratingAverage: number | null): string => {
  if (ratingAverage === null) return NO_NUMBER_TEXT;
  return ratingAverage.toFixed(RATING_DECIMALS);
};

/** The compact lines for one app: a title, then one line per headline number. */
export const describeAppStats = (appReport: AppStatsReport): string[] => {
  let owner = 'untagged';
  if (appReport.owner !== null) owner = appReport.owner;
  const downloads = readHeadlineTotal(appReport.totals, DOWNLOAD_METRICS);
  const usage = readHeadlineTotal(appReport.totals, USAGE_METRICS);
  const usageTotals = pickHeadlineTotals(appReport.totals, USAGE_METRICS);
  let usageLabel = 'sessions';
  if (usageTotals[0]?.metric === 'activeUsers') usageLabel = 'active users';
  const crashRate = readHeadlineTotal(appReport.totals, CRASH_METRICS);
  const rating = readHeadlineTotal(appReport.totals, RATING_METRICS);
  const lines = [
    { label: 'downloads', text: describeCount(downloads) },
    { label: 'proceeds', text: describeProceeds(appReport.totals) },
    { label: usageLabel, text: describeCount(usage) },
    { label: 'crash rate', text: describeCrashRate(crashRate) },
    { label: 'rating', text: describeRating(rating) },
  ].map((line) => `  ${line.label.padEnd(LABEL_WIDTH)}${line.text}`);
  return [
    `${appReport.name} (${appReport.platform}, ${owner}, ${appReport.accountLabel})`,
    ...lines,
  ];
};
