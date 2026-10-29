import type { HttpClient } from '@effect/platform';
import { Effect, Schema } from 'effect';
import type { DailyStat, DateRange } from '../../types/stats.js';
import {
  ANALYTICS_DATA_URL,
  createGa4Failure,
  requestGa4Json,
  type Ga4Failure,
  type Ga4Session,
} from './ga4Client.js';

const REPORT_PAGE_SIZE = 10000;
const GA4_METRICS: readonly Ga4Metric[] = ['activeUsers', 'newUsers', 'sessions'];

type Ga4Metric = 'activeUsers' | 'newUsers' | 'sessions';

interface Ga4Report {
  readonly propertyId: string;
  readonly streamId: string | null;
  readonly range: DateRange;
}

const ReportReplySchema = Schema.Struct({
  rows: Schema.optional(
    Schema.Array(
      Schema.Struct({
        dimensionValues: Schema.Array(Schema.Struct({ value: Schema.String })),
        metricValues: Schema.Array(Schema.Struct({ value: Schema.String })),
      }),
    ),
  ),
  rowCount: Schema.optional(Schema.Number),
});

type ReportReply = typeof ReportReplySchema.Type;

const createReportBody = (report: Ga4Report, offset: number) => {
  const reportBody = {
    dimensions: [{ name: 'date' }],
    metrics: GA4_METRICS.map((metricName) => ({ name: metricName })),
    dateRanges: [{ startDate: report.range.from, endDate: report.range.to }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: String(REPORT_PAGE_SIZE),
    offset: String(offset),
  };
  if (report.streamId === null) return reportBody;
  return {
    ...reportBody,
    dimensionFilter: {
      filter: {
        fieldName: 'streamId',
        stringFilter: { matchType: 'EXACT', value: report.streamId },
      },
    },
  };
};

/** GA4 writes dates as YYYYMMDD. */
export const readReportDate = (compactDate: string): string =>
  `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`;

export const createStatsFromReport = (reportReply: ReportReply): readonly DailyStat[] => {
  const dailyStats: DailyStat[] = [];
  for (const reportRow of reportReply.rows ?? []) {
    const compactDate = reportRow.dimensionValues[0]?.value;
    if (compactDate === undefined) continue;
    const date = readReportDate(compactDate);
    GA4_METRICS.forEach((metricName, metricIndex) => {
      const metricText = reportRow.metricValues[metricIndex]?.value;
      if (metricText === undefined) return;
      dailyStats.push({
        date,
        feed: 'ga4',
        metric: metricName,
        value: Number(metricText),
        currency: null,
      });
    });
  }
  return dailyStats;
};

const loadReportPages = (
  session: Ga4Session,
  report: Ga4Report,
  offset: number,
): Effect.Effect<readonly DailyStat[], Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const replyBody = yield* requestGa4Json(session, {
      url: `${ANALYTICS_DATA_URL}/properties/${report.propertyId}:runReport`,
      body: createReportBody(report, offset),
      propertyId: report.propertyId,
    });
    const reportReply = yield* Schema.decodeUnknown(ReportReplySchema)(replyBody).pipe(
      Effect.mapError((cause) => createGa4Failure(session, 'Unreadable GA4 report', cause)),
    );
    const pageStats = createStatsFromReport(reportReply);
    const pageRowCount = reportReply.rows?.length ?? 0;
    const nextOffset = offset + pageRowCount;
    const totalRowCount = reportReply.rowCount ?? 0;
    const isLastPage = pageRowCount === 0 || nextOffset >= totalRowCount;
    if (isLastPage) return pageStats;
    const laterStats = yield* loadReportPages(session, report, nextOffset);
    return [...pageStats, ...laterStats];
  });

/** Daily active users, new users and sessions for one property, optionally cut to one stream. */
export const loadGa4Report = (
  session: Ga4Session,
  report: Ga4Report,
): Effect.Effect<readonly DailyStat[], Ga4Failure, HttpClient.HttpClient> =>
  loadReportPages(session, report, 0);
