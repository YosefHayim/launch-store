import { Duration, Effect } from 'effect';
import { parseOwnerFlag, parsePlatformFlag } from '../portfolio/appsCommand.js';
import { errorMessage } from '../services/errorMessage.js';
import type { Logger } from '../services/logger.js';
import { ensureFreshStats } from '../stats/ensureFreshStats.js';
import { readStatsReport } from '../stats/statsReport.js';
import { parseDaysFlag } from '../stats/statsSyncCommand.js';
import type { StatsSyncRequirements } from '../stats/syncStats.js';
import type { StatsFreshness } from '../types/stats.js';
import type { StatsReport, StatsReportRequest } from '../types/statsReport.js';
import { createAppsTabHtml } from './appsTabHtml.js';
import type { DashboardHttpReply } from './server.js';

const REFRESH_TIMEOUT_SECONDS = 10;
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const TIMED_OUT_FRESHNESS: StatsFreshness = { isStale: true, report: null };

const createTextReply = (status: number, message: string): DashboardHttpReply => ({
  status,
  contentType: TEXT_CONTENT_TYPE,
  content: message,
});

const readQueryText = (searchParams: URLSearchParams, name: string): string | undefined => {
  const queryText = searchParams.get(name);
  if (queryText === null) return undefined;
  return queryText;
};

const readAppName = (searchParams: URLSearchParams): string | null => {
  const appName = searchParams.get('app');
  if (appName === null) return null;
  return appName;
};

const readStatsRequest = (searchParams: URLSearchParams) =>
  Effect.gen(function* () {
    const platform = yield* parsePlatformFlag(readQueryText(searchParams, 'platform'));
    const owner = yield* parseOwnerFlag(readQueryText(searchParams, 'owner'));
    const days = yield* parseDaysFlag(readQueryText(searchParams, 'days'));
    const request: StatsReportRequest = {
      platform,
      owner,
      appName: readAppName(searchParams),
      days,
    };
    return request;
  });

const refreshWithinTimeout = (
  appName: string | null,
): Effect.Effect<StatsFreshness, never, StatsSyncRequirements> =>
  ensureFreshStats(appName).pipe(
    Effect.timeoutTo({
      duration: Duration.seconds(REFRESH_TIMEOUT_SECONDS),
      onSuccess: (freshness): StatsFreshness => freshness,
      onTimeout: () => TIMED_OUT_FRESHNESS,
    }),
  );

/** Refresh old numbers for at most 10 seconds, read the report, and answer with the chosen body. */
const createStatsReply = (
  searchParams: URLSearchParams,
  logger: Logger,
  createBody: (report: StatsReport) => DashboardHttpReply,
): Effect.Effect<DashboardHttpReply, never, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const request = yield* readStatsRequest(searchParams);
    const freshness = yield* refreshWithinTimeout(request.appName);
    const report = yield* readStatsReport(request, freshness);
    return createBody(report);
  }).pipe(
    Effect.catchTags({
      UsageFailure: (usageFailure) => Effect.succeed(createTextReply(400, usageFailure.message)),
      StatsReportAppNotFoundFailure: (notFound) =>
        Effect.succeed(createTextReply(404, notFound.message)),
    }),
    Effect.catchAll((failure) =>
      logger.error(`dashboard stats failed: ${errorMessage(failure)}`).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.as(createTextReply(500, 'Failed to read saved stats - see the terminal.')),
      ),
    ),
  );

/** `/apps`: the server-rendered Apps tab. */
export const appsTabReply = (
  searchParams: URLSearchParams,
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, StatsSyncRequirements> =>
  createStatsReply(searchParams, logger, (report) => ({
    status: 200,
    contentType: HTML_CONTENT_TYPE,
    content: createAppsTabHtml(report),
  }));

/** `/api/stats`: the same report as JSON. */
export const statsApiReply = (
  searchParams: URLSearchParams,
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, StatsSyncRequirements> =>
  createStatsReply(searchParams, logger, (report) => ({
    status: 200,
    contentType: JSON_CONTENT_TYPE,
    content: JSON.stringify(report),
  }));
