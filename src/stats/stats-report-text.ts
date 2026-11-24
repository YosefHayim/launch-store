// Writes the lines for one app's downloads, proceeds, crashes, and rating.

import type { StatsMetric } from '../types/stats.ts';
import type { AppStatsReport, MetricTotal } from '../types/stats-report.ts';
import { listProceedsTotals, pickHeadlineTotals, readHeadlineTotal } from './stats-series.ts';
const USAGE_METRICS: readonly StatsMetric[] = ['sessions', 'activeUsers'];

const NO_NUMBER_MARK = '-';

/** A count with thousands separators, or a dash when the feed gave no number. */
export function describeCount(count: number | null): string {
  if (count == null) return NO_NUMBER_MARK;

  const countMaximumDecimals = 1;
  return count.toLocaleString('en-US', { maximumFractionDigits: countMaximumDecimals });
}

/** Proceeds as `USD 56.20, EUR 10.00`, one part per currency, or a dash when there are none. */
export function describeProceeds(totals: readonly MetricTotal[]): string {
  const proceedsTotals = listProceedsTotals(totals);

  const hasNoProceeds = proceedsTotals.length == 0;

  if (hasNoProceeds) return NO_NUMBER_MARK;

  const moneyDecimals = 2;

  function readProceedsLabel(total: MetricTotal) {
    return `${total.currency} ${total.total.toFixed(moneyDecimals)}`;
  }

  return proceedsTotals.map(readProceedsLabel).join(', ');
}

/** A stored crash rate (a fraction) as a percent, or a dash. */
export function describeCrashRate(crashRate: number | null): string {
  if (crashRate == null) return NO_NUMBER_MARK;

  const percentFactor = 100;
  const crashRateDecimals = 2;

  return `${(crashRate * percentFactor).toFixed(crashRateDecimals)}%`;
}

/** A rating average, or a dash. */
export function describeRating(ratingAverage: number | null): string {
  if (ratingAverage == null) return NO_NUMBER_MARK;

  const ratingDecimals = 2;
  return ratingAverage.toFixed(ratingDecimals);
}

/** The owner of an app, or `untagged`. */
export function describeOwner(owner: string | null): string {
  if (owner == null) return 'untagged';

  return owner;
}

function readUsageLabel(usageTotals: readonly MetricTotal[]): string {
  function isActiveUsersTotal(total: MetricTotal) {
    return total.metric == 'activeUsers';
  }

  const isActiveUsers = usageTotals.some(isActiveUsersTotal);

  if (isActiveUsers) return 'active users';

  return 'sessions';
}

/** The compact lines for one app: a title, then one line per headline number. */
export function describeAppStats(appReport: AppStatsReport): string[] {
  const owner = describeOwner(appReport.owner);
  const downloads = readHeadlineTotal(appReport.totals, ['downloads', 'installs']);
  const usage = readHeadlineTotal(appReport.totals, USAGE_METRICS);
  const usageTotals = pickHeadlineTotals(appReport.totals, USAGE_METRICS);
  const usageLabel = readUsageLabel(usageTotals);
  const crashRate = readHeadlineTotal(appReport.totals, ['crashRate']);
  const rating = readHeadlineTotal(appReport.totals, ['ratingAverage']);
  const labelWidth = 14;

  function padStatLine(line: { label: string; figure: string }) {
    return `  ${line.label.padEnd(labelWidth)}${line.figure}`;
  }

  const lines = [
    { label: 'downloads', figure: describeCount(downloads) },
    { label: 'proceeds', figure: describeProceeds(appReport.totals) },
    { label: usageLabel, figure: describeCount(usage) },
    { label: 'crash rate', figure: describeCrashRate(crashRate) },
    { label: 'rating', figure: describeRating(rating) },
  ].map(padStatLine);

  function readNoteLine(message: string) {
    return `  note: ${message}`;
  }

  const messageLines = appReport.messages.map(readNoteLine);

  return [
    `${appReport.name} (${appReport.platform}, ${owner}, ${appReport.accountLabel})`,
    ...lines,
    ...messageLines,
  ];
}
