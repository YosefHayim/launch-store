import { Effect } from 'effect';
import { LaunchLogger, type Logger } from '../services/logger.js';
import { makeCommandExit, type CommandExit } from '../terminal/commandExit.js';
import {
  endWithUsageFailure,
  makeUsageFailure,
  type UsageFailure,
} from '../terminal/usageFailure.js';
import type { AppFeedSyncReport } from '../types/stats.js';
import { DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS } from './dateRange.js';
import { syncStats, type StatsSyncRequirements } from './syncStats.js';
import type { JsonFileFailure } from '../services/atomicJsonFile.js';
import type { InvalidAppKeyFailure } from '../services/paths.js';
import type { SyncLockFailure } from './syncLock.js';

export interface StatsSyncCommandRequest {
  readonly app: string | undefined;
  readonly days: string | undefined;
  readonly json: boolean;
}

type StatsSyncCommandFailure = InvalidAppKeyFailure | JsonFileFailure | SyncLockFailure;

const FAILED_FEED_EXIT_CODE = 1;
const DAYS_PATTERN = /^[0-9]+$/;

/** Check `--days`: a whole number from 1 to 365, or the default when the flag is absent. */
export const parseDaysFlag = (
  daysText: string | undefined,
): Effect.Effect<number, UsageFailure> => {
  if (daysText === undefined) return Effect.succeed(DEFAULT_SYNC_DAYS);
  const isWholeNumber = DAYS_PATTERN.test(daysText);
  const days = Number(daysText);
  const isInRange = days >= 1 && days <= MAX_SYNC_DAYS;
  if (isWholeNumber && isInRange) return Effect.succeed(days);
  return Effect.fail(
    makeUsageFailure({ message: `--days must be a whole number from 1 to ${MAX_SYNC_DAYS}.` }),
  );
};

const describeAppFeed = (appFeed: AppFeedSyncReport): string => {
  let suffix = '';
  if (appFeed.message !== null) suffix = ` (${appFeed.message})`;
  return `${appFeed.appKey} ${appFeed.feed}: ${appFeed.status}${suffix}`;
};

/** `launch stats sync`: pull the missing days of every feed into the local stats files. */
export const statsSyncProgram = (
  request: StatsSyncCommandRequest,
): Effect.Effect<void, CommandExit | StatsSyncCommandFailure, StatsSyncRequirements | Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const days = yield* parseDaysFlag(request.days);
    let appName: string | null = null;
    if (request.app !== undefined) appName = request.app;
    const report = yield* syncStats({ appName, days }).pipe(
      Effect.catchTag('StatsAppNotFoundFailure', (notFound) =>
        Effect.fail(makeUsageFailure({ message: notFound.message })),
      ),
    );
    if (request.json) {
      yield* logger.line(JSON.stringify({ ok: true, ...report })).pipe(Effect.orDie);
    }
    if (!request.json) {
      for (const appFeed of report.appFeeds) {
        yield* logger.line(describeAppFeed(appFeed)).pipe(Effect.orDie);
      }
    }
    const hasFeedFailed = report.appFeeds.some((appFeed) => appFeed.status === 'failed');
    if (hasFeedFailed) {
      return yield* Effect.fail(
        makeCommandExit({
          exitCode: FAILED_FEED_EXIT_CODE,
          message: 'At least one stats feed failed.',
        }),
      );
    }
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.json),
    ),
  );
