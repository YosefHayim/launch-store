import type { DailyStat, DateRange } from '../../types/stats.ts';
import type {
  AnalyticsAccessType,
  AnalyticsReportBatch,
  AnalyticsReportKind,
  ReportLine,
} from './app-store-feed-types.ts';
import { readCell, roundMoney, sumColumn } from './report-cells.ts';

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
function rankBatch(accessType: AnalyticsAccessType, processingDate: string): string {
  const isOngoing = accessType == 'ONGOING';

  if (isOngoing) return `1|${processingDate}`;

  return `0|${processingDate}`;
}

const isoDateLength = 10;
function readLineDate(line: ReportLine): string {
  return readCell(line, 'Date').slice(0, isoDateLength);
}

function isLineWanted(line: ReportLine, request: AnalyticsReadRequest): boolean {
  const date = readLineDate(line);

  const isDateOutsideRange = date < request.range.from || date > request.range.to;

  if (isDateOutsideRange) return false;

  const appIdentifier = readCell(line, 'App Apple Identifier');

  const isAppIdentifierMissing = appIdentifier == '';

  if (isAppIdentifierMissing) return true;

  return appIdentifier == request.storeId;
}

interface RankedLine {
  readonly line: ReportLine;
  readonly date: string;
  readonly rank: string;
}

function pickLatestLines(
  batches: readonly AnalyticsReportBatch[],
  request: AnalyticsReadRequest,
): readonly ReportLine[] {
  function flatMapBatch(batch: AnalyticsReportBatch): RankedLine[] {
    const rank = rankBatch(batch.accessType, batch.processingDate);

    function filterLine(line: { readonly [x: string]: string }) {
      return isLineWanted(line, request);
    }

    function mapLine(line: { readonly [x: string]: string }) {
      return { line, date: readLineDate(line), rank };
    }

    return batch.lines.filter(filterLine).map(mapLine);
  }

  const rankedLines = batches.flatMap(flatMapBatch);
  const bestRankByDate = new Map<string, string>();

  for (const rankedLine of rankedLines) {
    const bestRank = bestRankByDate.get(rankedLine.date);

    if (bestRank == null) {
      bestRankByDate.set(rankedLine.date, rankedLine.rank);
      continue;
    }

    const isRankedLineNewer = rankedLine.rank > bestRank;

    if (isRankedLineNewer) bestRankByDate.set(rankedLine.date, rankedLine.rank);
  }

  function filterRankedLine(rankedLine: RankedLine) {
    return rankedLine.rank == bestRankByDate.get(rankedLine.date);
  }

  function readLine(rankedLine: RankedLine) {
    return rankedLine.line;
  }

  return rankedLines.filter(filterRankedLine).map(readLine);
}

function isLineCounted(line: ReportLine, rule: AnalyticsMetricRule): boolean {
  if (rule.labelColumn == null) return true;

  return rule.labels.includes(readCell(line, rule.labelColumn).toLowerCase());
}

function groupLinesByDate(
  lines: readonly ReportLine[],
): ReadonlyMap<string, readonly ReportLine[]> {
  const dates = new Set(lines.map(readLineDate));

  function mapDate(date: string): readonly [string, readonly ReportLine[]] {
    function filterLine3(line: ReportLine) {
      return readLineDate(line) == date;
    }

    return [date, lines.filter(filterLine3)];
  }

  return new Map([...dates].map(mapDate));
}

function createRuleStats(
  lines: readonly ReportLine[],
  rule: AnalyticsMetricRule,
): readonly DailyStat[] {
  function filterLine2(line: { readonly [x: string]: string }) {
    return isLineCounted(line, rule);
  }

  const linesByDate = groupLinesByDate(lines.filter(filterLine2));

  function mapPiece([date, dateLines]: [
    string,
    readonly Readonly<Record<string, string>>[],
  ]): DailyStat {
    const total = sumColumn(dateLines, rule.countColumn);

    return {
      date,
      feed: 'app-store',
      metric: rule.metric,
      value: roundMoney(total),
      currency: rule.currency,
    };
  }

  return [...linesByDate.entries()].map(mapPiece);
}

function findLatestDate(lines: readonly ReportLine[]): string | null {
  const dates = lines.map(readLineDate);

  if (dates.length == 0) return null;

  function reduceLatestDate(latestDate: string, date: string) {
    if (date > latestDate) return date;

    return latestDate;
  }

  return dates.reduce(reduceLatestDate);
}

/** Daily stats of one app from downloaded analytics segments; counts of the app's lines are summed per date. */
export function summarizeAnalyticsBatches(
  batches: readonly AnalyticsReportBatch[],
  request: AnalyticsReadRequest,
): AnalyticsSummary {
  function readKind(rule: AnalyticsMetricRule) {
    return rule.kind;
  }

  const kinds = new Set(ANALYTICS_METRIC_RULES.map(readKind));
  const linesByKind = new Map<AnalyticsReportKind, readonly ReportLine[]>();

  for (const kind of kinds) {
    function filterBatch(batch: AnalyticsReportBatch) {
      return batch.kind == kind;
    }

    const kindBatches = batches.filter(filterBatch);
    const latestLines = pickLatestLines(kindBatches, request);

    linesByKind.set(kind, latestLines);
  }

  function flatMapRule(rule: AnalyticsMetricRule) {
    const kindLines = linesByKind.get(rule.kind);

    if (kindLines == null) return [];

    return createRuleStats(kindLines, rule);
  }

  const stats = ANALYTICS_METRIC_RULES.flatMap(flatMapRule);
  const allLines = [...linesByKind.values()].flat();

  return { stats, latestDate: findLatestDate(allLines) };
}
