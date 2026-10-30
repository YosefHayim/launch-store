import { Effect } from 'effect';
import { parseOwnerFlag, parsePlatformFlag } from '../portfolio/appsCommand.js';
import { LaunchLogger, type Logger } from '../services/logger.js';
import type { CommandExit } from '../terminal/commandExit.js';
import {
  endWithUsageFailure,
  makeUsageFailure,
  type UsageFailure,
} from '../terminal/usageFailure.js';
import type { AppStatsReport, StatsReport } from '../types/statsReport.js';
import { parseDaysFlag } from './statsSyncCommand.js';
import { createStatsReport, type StatsReportFailure } from './statsReport.js';
import { describeAppStats } from './statsReportText.js';
import type { StatsSyncRequirements } from './syncStats.js';

export interface StatsCommandRequest {
  readonly platform: string | undefined;
  readonly owner: string | undefined;
  readonly app: string | undefined;
  readonly days: string | undefined;
  readonly json: boolean;
}

const showAppReport = (appReport: AppStatsReport): Effect.Effect<void, never, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    for (const line of describeAppStats(appReport)) {
      yield* logger.line(line).pipe(Effect.orDie);
    }
  });

const showReport = (report: StatsReport): Effect.Effect<void, never, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const hasNoApps = report.apps.length === 0;
    if (hasNoApps) yield* logger.note('No apps found.').pipe(Effect.orDie);
    for (const appReport of report.apps) yield* showAppReport(appReport);
    if (report.isStale) {
      yield* logger
        .warn('Some numbers are old: a sync did not finish. Run `launch stats sync` to see why.')
        .pipe(Effect.orDie);
    }
  });

const readAppName = (appText: string | undefined): string | null => {
  if (appText === undefined) return null;
  return appText;
};

/** `launch stats`: read the saved numbers of the apps, after refreshing the old ones. */
export const statsReportProgram = (
  request: StatsCommandRequest,
): Effect.Effect<
  void,
  CommandExit | Exclude<StatsReportFailure, { _tag: 'StatsReportAppNotFoundFailure' }>,
  StatsSyncRequirements | Logger
> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const platform = yield* parsePlatformFlag(request.platform);
    const owner = yield* parseOwnerFlag(request.owner);
    const days = yield* parseDaysFlag(request.days);
    const report = yield* createStatsReport({
      platform,
      owner,
      appName: readAppName(request.app),
      days,
    }).pipe(
      Effect.catchTag('StatsReportAppNotFoundFailure', (notFound) =>
        Effect.fail<UsageFailure>(makeUsageFailure({ message: notFound.message })),
      ),
    );
    if (request.json) {
      return yield* logger.line(JSON.stringify({ ok: true, ...report })).pipe(Effect.orDie);
    }
    yield* showReport(report);
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.json),
    ),
  );
