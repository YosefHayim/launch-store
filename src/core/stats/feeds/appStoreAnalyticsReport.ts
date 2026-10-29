import type { DailyStat, DateRange } from '../../types/stats.js';
import type {
  AnalyticsAccessType,
  AnalyticsReportBatch,
  AnalyticsReportKind,
  ReportLine,
} from './appStoreFeedTypes.js';
import { readCell, roundMoney, sumColumn } from './reportCells.js';

const DATE_COLUMN = 'Date';
const APP_IDENTIFIER_COLUMN = 'App Apple Identifier';
const ISO_DATE_LENGTH = 10;

/** The Standard report names Apple lists under an analytics report request. */
export const ANALYTICS_REPORT_NAMES: Readonly<Record<AnalyticsReportKind, string>> = {
  discovery: 'App Store Discovery and Engagement Standard',
  downloads: 'App Downloads Standard',
  purchases: 'App Store Purchases Standard',
  sessions: 'App Sessions Standard',
  crashes: 'App Crashes',
  installs: 'App Store Installation and Deletion Standard',
};

interface AnalyticsMetricRule {
  readonly kind: AnalyticsReportKind;
  readonly metric: DailyStat['metric'];
  readonly countColumn: string;
  readonly labelColumn: string | null;
  readonly labels: readonly string[];
  readonly currency: string | null;
}

// Column names and labels: https://developer.apple.com/documentation/analytics-reports
const ANALYTICS_METRIC_RULES: readonly AnalyticsMetricRule[] = [
  {
    kind: 'discovery',
    metric: 'impressions',
    countColumn: 'Counts',
    labelColumn: 'Event',
    labels: ['impression'],
    currency: null,
  },
  {
    kind: 'discovery',
    metric: 'productPageViews',
    countColumn: 'Counts',
    labelColumn: 'Event',
    labels: ['page view'],
    currency: null,
  },
  {
    kind: 'sessions',
    metric: 'sessions',
    countColumn: 'Sessions',
    labelColumn: null,
    labels: [],
    currency: null,
  },
  {
    kind: 'sessions',
    metric: 'activeDevices',
    countColumn: 'Unique Devices',
    labelColumn: null,
    labels: [],
    currency: null,
  },
  {
    kind: 'crashes',
    metric: 'crashes',
    countColumn: 'Crashes',
    labelColumn: null,
    labels: [],
    currency: null,
  },
  {
    kind: 'installs',
    metric: 'installs',
    countColumn: 'Counts',
    labelColumn: 'Event',
    labels: ['install'],
    currency: null,
  },
  {
    kind: 'installs',
    metric: 'uninstalls',
    countColumn: 'Counts',
    labelColumn: 'Event',
    labels: ['delete'],
    currency: null,
  },
  {
    kind: 'downloads',
    metric: 'downloads',
    countColumn: 'Counts',
    labelColumn: 'Download Type',
    labels: ['first-time download'],
    currency: null,
  },
  {
    kind: 'downloads',
    metric: 'redownloads',
    countColumn: 'Counts',
    labelColumn: 'Download Type',
    labels: ['redownload', 'restore'],
    currency: null,
  },
  {
    kind: 'downloads',
    metric: 'updates',
    countColumn: 'Counts',
    labelColumn: 'Download Type',
    labels: ['manual update', 'auto-update'],
    currency: null,
  },
  {
    kind: 'purchases',
    metric: 'proceeds',
    countColumn: 'Proceeds in USD',
    labelColumn: null,
    labels: [],
    currency: 'USD',
  },
];

interface AnalyticsReadRequest {
  readonly storeId: string;
  readonly range: DateRange;
}

export interface AnalyticsSummary {
  readonly stats: readonly DailyStat[];
  readonly latestDate: string | null;
}

// A later instance overwrites an earlier one for the same Date, and ongoing data beats the snapshot.
const rankBatch = (accessType: AnalyticsAccessType, processingDate: string): string => {
  const isOngoing = accessType === 'ONGOING';
  if (isOngoing) return `1|${processingDate}`;
  return `0|${processingDate}`;
};

const readLineDate = (line: ReportLine): string =>
  readCell(line, DATE_COLUMN).slice(0, ISO_DATE_LENGTH);

const isLineWanted = (line: ReportLine, request: AnalyticsReadRequest): boolean => {
  const date = readLineDate(line);
  const isDateOutsideRange = date < request.range.from || date > request.range.to;
  if (isDateOutsideRange) return false;
  const appIdentifier = readCell(line, APP_IDENTIFIER_COLUMN);
  const isAppIdentifierMissing = appIdentifier === '';
  if (isAppIdentifierMissing) return true;
  return appIdentifier === request.storeId;
};

interface RankedLine {
  readonly line: ReportLine;
  readonly date: string;
  readonly rank: string;
}

const pickLatestLines = (
  batches: readonly AnalyticsReportBatch[],
  request: AnalyticsReadRequest,
): readonly ReportLine[] => {
  const rankedLines = batches.flatMap((batch): RankedLine[] => {
    const rank = rankBatch(batch.accessType, batch.processingDate);
    return batch.lines
      .filter((line) => isLineWanted(line, request))
      .map((line) => ({ line, date: readLineDate(line), rank }));
  });
  const bestRankByDate = new Map<string, string>();
  for (const rankedLine of rankedLines) {
    const bestRank = bestRankByDate.get(rankedLine.date);
    if (bestRank === undefined) {
      bestRankByDate.set(rankedLine.date, rankedLine.rank);
      continue;
    }
    const isRankedLineNewer = rankedLine.rank > bestRank;
    if (isRankedLineNewer) bestRankByDate.set(rankedLine.date, rankedLine.rank);
  }
  return rankedLines
    .filter((rankedLine) => rankedLine.rank === bestRankByDate.get(rankedLine.date))
    .map((rankedLine) => rankedLine.line);
};

const isLineCounted = (line: ReportLine, rule: AnalyticsMetricRule): boolean => {
  if (rule.labelColumn === null) return true;
  return rule.labels.includes(readCell(line, rule.labelColumn).toLowerCase());
};

const groupLinesByDate = (
  lines: readonly ReportLine[],
): ReadonlyMap<string, readonly ReportLine[]> => {
  const linesByDate = new Map<string, ReportLine[]>();
  for (const line of lines) {
    const date = readLineDate(line);
    const knownLines = linesByDate.get(date);
    if (knownLines === undefined) {
      linesByDate.set(date, [line]);
      continue;
    }
    knownLines.push(line);
  }
  return linesByDate;
};

const createRuleStats = (
  lines: readonly ReportLine[],
  rule: AnalyticsMetricRule,
): readonly DailyStat[] => {
  const linesByDate = groupLinesByDate(lines.filter((line) => isLineCounted(line, rule)));
  return [...linesByDate.entries()].map(([date, dateLines]): DailyStat => {
    const total = sumColumn(dateLines, rule.countColumn);
    return {
      date,
      feed: 'app-store',
      metric: rule.metric,
      value: roundMoney(total),
      currency: rule.currency,
    };
  });
};

const findLatestDate = (lines: readonly ReportLine[]): string | null => {
  const dates = lines.map(readLineDate);
  if (dates.length === 0) return null;
  return dates.reduce((latestDate, date) => {
    if (date > latestDate) return date;
    return latestDate;
  });
};

/** Daily stats of one app from downloaded analytics segments; counts of the app's lines are summed per date. */
export const summarizeAnalyticsBatches = (
  batches: readonly AnalyticsReportBatch[],
  request: AnalyticsReadRequest,
): AnalyticsSummary => {
  const kinds = new Set(ANALYTICS_METRIC_RULES.map((rule) => rule.kind));
  const linesByKind = new Map<AnalyticsReportKind, readonly ReportLine[]>();
  for (const kind of kinds) {
    const kindBatches = batches.filter((batch) => batch.kind === kind);
    linesByKind.set(kind, pickLatestLines(kindBatches, request));
  }
  const stats = ANALYTICS_METRIC_RULES.flatMap((rule) => {
    const kindLines = linesByKind.get(rule.kind);
    if (kindLines === undefined) return [];
    return createRuleStats(kindLines, rule);
  });
  const allLines = [...linesByKind.values()].flat();
  return { stats, latestDate: findLatestDate(allLines) };
};
