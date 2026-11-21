import type { StatsMetric } from '../types/stats.js';
import type { AppStatsReport, MetricTotal } from '../types/statsReport.js';
import { listProceedsTotals, pickHeadlineTotals, readHeadlineTotal } from './statsReportLogic.js';

const DOWNLOAD_METRICS: readonly StatsMetric[] = ['downloads', 'installs'];
const USAGE_METRICS: readonly StatsMetric[] = ['sessions', 'activeUsers'];
const CRASH_METRICS: readonly StatsMetric[] = ['crashRate'];
const RATING_METRICS: readonly StatsMetric[] = ['ratingAverage'];

const NO_NUMBER_MARK = '-';

/** A count with thousands separators, or a dash when the feed gave no number. */
export const describeCount = (count: number | null): string => {
  if (count === null) return NO_NUMBER_MARK;
  const countMaximumDecimals = 1;
  return count.toLocaleString('en-US', { maximumFractionDigits: countMaximumDecimals });
};

/** Proceeds as `USD 56.20, EUR 10.00`, one part per currency, or a dash when there are none. */
export const describeProceeds = (totals: readonly MetricTotal[]): string => {
  const proceedsTotals = listProceedsTotals(totals);
  const hasNoProceeds = proceedsTotals.length === 0;
  if (hasNoProceeds) return NO_NUMBER_MARK;
  const moneyDecimals = 2;
  return proceedsTotals
    .map((total) => `${total.currency} ${total.total.toFixed(moneyDecimals)}`)
    .join(', ');
};

/** A stored crash rate (a fraction) as a percent, or a dash. */
export const describeCrashRate = (crashRate: number | null): string => {
  if (crashRate === null) return NO_NUMBER_MARK;
  const percentFactor = 100;
  const crashRateDecimals = 2;
  return `${(crashRate * percentFactor).toFixed(crashRateDecimals)}%`;
};

/** A rating average, or a dash. */
export const describeRating = (ratingAverage: number | null): string => {
  if (ratingAverage === null) return NO_NUMBER_MARK;
  const ratingDecimals = 2;
  return ratingAverage.toFixed(ratingDecimals);
};

/** The owner of an app, or `untagged`. */
export const describeOwner = (owner: string | null): string => {
  if (owner === null) return 'untagged';
  return owner;
};

const readUsageLabel = (usageTotals: readonly MetricTotal[]): string => {
  const isActiveUsers = usageTotals.some((total) => total.metric === 'activeUsers');
  if (isActiveUsers) return 'active users';
  return 'sessions';
};

/** The compact lines for one app: a title, then one line per headline number. */
export const describeAppStats = (appReport: AppStatsReport): string[] => {
  const owner = describeOwner(appReport.owner);
  const downloads = readHeadlineTotal(appReport.totals, DOWNLOAD_METRICS);
  const usage = readHeadlineTotal(appReport.totals, USAGE_METRICS);
  const usageTotals = pickHeadlineTotals(appReport.totals, USAGE_METRICS);
  const usageLabel = readUsageLabel(usageTotals);
  const crashRate = readHeadlineTotal(appReport.totals, CRASH_METRICS);
  const rating = readHeadlineTotal(appReport.totals, RATING_METRICS);
  const labelWidth = 14;
  const lines = [
    { label: 'downloads', figure: describeCount(downloads) },
    { label: 'proceeds', figure: describeProceeds(appReport.totals) },
    { label: usageLabel, figure: describeCount(usage) },
    { label: 'crash rate', figure: describeCrashRate(crashRate) },
    { label: 'rating', figure: describeRating(rating) },
  ].map((line) => `  ${line.label.padEnd(labelWidth)}${line.figure}`);
  const messageLines = appReport.messages.map((message) => `  note: ${message}`);
  return [
    `${appReport.name} (${appReport.platform}, ${owner}, ${appReport.accountLabel})`,
    ...lines,
    ...messageLines,
  ];
};
