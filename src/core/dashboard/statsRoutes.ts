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
const HTML_MEDIA_TYPE = 'text/html; charset=utf-8';
const JSON_MEDIA_TYPE = 'application/json; charset=utf-8';
const PLAIN_MEDIA_TYPE = 'text/plain; charset=utf-8';

const TIMED_OUT_FRESHNESS: StatsFreshness = { isStale: true, report: null };

const createPlainReply = (status: number, message: string): DashboardHttpReply => ({
  status,
  contentType: PLAIN_MEDIA_TYPE,
  content: message,
});

const readQueryParameter = (searchParams: URLSearchParams, name: string): string | null =>
  searchParams.get(name);

const readFlagParameter = (searchParams: URLSearchParams, name: string): string | undefined => {
  const queryParameter = readQueryParameter(searchParams, name);
  if (queryParameter === null) return undefined;
  return queryParameter;
};

const readAppName = (searchParams: URLSearchParams): string | null =>
  readQueryParameter(searchParams, 'app');

const readStatsRequest = (searchParams: URLSearchParams) =>
  Effect.gen(function* () {
    const platform = yield* parsePlatformFlag(readFlagParameter(searchParams, 'platform'));
    const owner = yield* parseOwnerFlag(readFlagParameter(searchParams, 'owner'));
    const days = yield* parseDaysFlag(readFlagParameter(searchParams, 'days'));
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
      UsageFailure: (usageFailure) => Effect.succeed(createPlainReply(400, usageFailure.message)),
      StatsReportAppNotFoundFailure: (notFound) =>
        Effect.succeed(createPlainReply(404, notFound.message)),
    }),
    Effect.catchAll((failure) =>
      logger.error(`dashboard stats failed: ${errorMessage(failure)}`).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.as(createPlainReply(500, 'Failed to read saved stats - see the terminal.')),
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
    contentType: HTML_MEDIA_TYPE,
    content: createAppsTabHtml(report),
  }));

/** `/api/stats`: the same report as JSON. */
export const statsApiReply = (
  searchParams: URLSearchParams,
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, StatsSyncRequirements> =>
  createStatsReply(searchParams, logger, (report) => ({
    status: 200,
    contentType: JSON_MEDIA_TYPE,
    content: JSON.stringify(report),
  }));
