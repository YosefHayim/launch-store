// Reads daily active users, new users, and sessions from a Google Analytics property.

import type { DailyStat, DateRange } from '../../types/stats.ts';
import {
  ANALYTICS_DATA_URL,
  createGa4Failure,
  requestGa4Document,
  type Ga4Session,
} from './ga4-client.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';

const GA4_METRICS: readonly Ga4Metric[] = ['activeUsers', 'newUsers', 'sessions'];

export type Ga4Metric = 'activeUsers' | 'newUsers' | 'sessions';

interface Ga4Report {
  readonly propertyId: string;
  readonly streamId: string | null;
  readonly range: DateRange;
}

interface ReportCell {
  readonly value: string;
}

interface ReportRow {
  readonly dimensionValues: readonly ReportCell[];
  readonly metricValues: readonly ReportCell[];
}

interface Ga4ReportReply {
  readonly rows: readonly ReportRow[];
  readonly rowCount: number;
}

function decodeCell(cellDocument: unknown): ReportCell {
  const cellDocumentObject = readPlainObject(cellDocument);

  if (cellDocumentObject == null) {
    throw new Error('A GA4 report cell is not an object.');
  }

  if (typeof cellDocumentObject['value'] != 'string') {
    throw new Error('A GA4 report cell value is not a string.');
  }

  return { value: cellDocumentObject['value'] };
}

function decodeCells(cells: unknown): readonly ReportCell[] {
  if (Array.isArray(cells) == false) {
    throw new Error('GA4 report cells are not a list.');
  }

  return cells.map(decodeCell);
}

function decodeReportRow(rowDocument: unknown): ReportRow {
  const rowDocumentObject = readPlainObject(rowDocument);

  if (rowDocumentObject == null) {
    throw new Error('A GA4 report row is not an object.');
  }

  return {
    dimensionValues: decodeCells(rowDocumentObject['dimensionValues']),
    metricValues: decodeCells(rowDocumentObject['metricValues']),
  };
}

function decodeReportReply(reportDocument: unknown): Ga4ReportReply {
  const reportDocumentObject = readPlainObject(reportDocument);

  if (reportDocumentObject == null) {
    throw new Error('A GA4 report is not an object.');
  }

  let rows: readonly ReportRow[] = [];
  let rowCount = 0;

  if (reportDocumentObject['rows'] != null) {
    if (Array.isArray(reportDocumentObject['rows']) == false) {
      throw new Error('GA4 report rows are not a list.');
    }

    rows = reportDocumentObject['rows'].map(decodeReportRow);
  }

  if (reportDocumentObject['rowCount'] != null) {
    if (typeof reportDocumentObject['rowCount'] != 'number') {
      throw new Error('GA4 report row count is not a number.');
    }

    rowCount = reportDocumentObject['rowCount'];
  }

  return { rows, rowCount };
}

function metricQuery(metricName: Ga4Metric): { name: string } {
  return { name: metricName };
}

function createReportQuery(
  report: Ga4Report,
  offset: number,
  metrics: readonly Ga4Metric[],
): unknown {
  const reportPageSize = 10000;
  const reportQuery = {
    dimensions: [{ name: 'date' }],
    metrics: metrics.map(metricQuery),
    dateRanges: [{ startDate: report.range.from, endDate: report.range.to }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: String(reportPageSize),
    offset: String(offset),
  };

  if (report.streamId == null) {
    return reportQuery;
  }

  return {
    ...reportQuery,
    dimensionFilter: {
      filter: {
        fieldName: 'streamId',
        stringFilter: { matchType: 'EXACT', value: report.streamId },
      },
    },
  };
}

/** GA4 writes dates as YYYYMMDD. */
export function readReportDate(compactDate: string): string {
  return `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;
}

function readMetricStat(date: string, metricValues: readonly ReportCell[]) {
  return function readOneMetric(metricName: Ga4Metric, metricIndex: number): DailyStat[] {
    const metricAmount = metricValues[metricIndex]?.value;

    if (metricAmount == null) {
      return [];
    }

    return [{ date, feed: 'ga4', metric: metricName, value: Number(metricAmount), currency: null }];
  };
}

function readRowStats(reportRow: ReportRow, metrics: readonly Ga4Metric[]): DailyStat[] {
  const compactDate = reportRow.dimensionValues[0]?.value;

  if (compactDate == null) {
    return [];
  }

  const date = readReportDate(compactDate);

  const metricStat = readMetricStat(date, reportRow.metricValues);

  return metrics.flatMap(metricStat);
}

export function createStatsFromReport(
  reportReply: Ga4ReportReply,
  metrics: readonly Ga4Metric[] | null = null,
): readonly DailyStat[] {
  const askedMetrics = metrics ?? GA4_METRICS;

  function readStats(reportRow: ReportRow): DailyStat[] {
    return readRowStats(reportRow, askedMetrics);
  }

  return reportReply.rows.flatMap(readStats);
}

async function loadReportPages(
  session: Ga4Session,
  report: Ga4Report,
  offset: number,
  metrics: readonly Ga4Metric[],
): Promise<readonly DailyStat[]> {
  const reportQuery = createReportQuery(report, offset, metrics);
  const reportDocument = await requestGa4Document(session, {
    url: `${ANALYTICS_DATA_URL}/properties/${report.propertyId}:runReport`,
    requestDocument: reportQuery,
    propertyId: report.propertyId,
  });

  try {
    var reportReply = decodeReportReply(reportDocument);
  } catch (cause) {
    throw createGa4Failure(session, 'Unreadable GA4 report', cause);
  }

  const pageStats = createStatsFromReport(reportReply, metrics);
  const pageRowCount = reportReply.rows.length;
  const nextOffset = offset + pageRowCount;
  const isPageEmpty = pageRowCount == 0;
  const isPastEnd = nextOffset >= reportReply.rowCount;

  if (isPageEmpty) {
    return pageStats;
  }

  if (isPastEnd) {
    return pageStats;
  }

  const laterStats = await loadReportPages(session, report, nextOffset, metrics);

  return [...pageStats, ...laterStats];
}

/** Daily active users, new users and sessions for one property, optionally cut to one stream. */
export async function loadGa4Report(
  session: Ga4Session,
  report: Ga4Report,
  metrics: readonly Ga4Metric[] | null = null,
): Promise<readonly DailyStat[]> {
  const askedMetrics = metrics ?? GA4_METRICS;

  return loadReportPages(session, report, 0, askedMetrics);
}
