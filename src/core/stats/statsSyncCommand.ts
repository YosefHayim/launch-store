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
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import type { InvalidAppKeyFailure } from '../services/paths.js';
import type { SyncLockFailure } from './syncLock.js';

export interface StatsSyncCommandRequest {
  readonly app: string | undefined;
  readonly days: string | undefined;
  readonly isJson: boolean;
}

type StatsSyncCommandFailure = InvalidAppKeyFailure | DocumentFileFailure | SyncLockFailure;

const FAILED_FEED_EXIT_CODE = 1;
const DAYS_PATTERN = /^[0-9]+$/;

export const parseDaysFlag = (
  daysFlag: string | undefined,
): Effect.Effect<number, UsageFailure> => {
  const isDaysFlagMissing = daysFlag === undefined;
  if (isDaysFlagMissing) return Effect.succeed(DEFAULT_SYNC_DAYS);
  const isWholeNumber = DAYS_PATTERN.test(daysFlag);
  const days = Number(daysFlag);
  const isInRange = days >= 1 && days <= MAX_SYNC_DAYS;
  if (isWholeNumber && isInRange) return Effect.succeed(days);
  const daysFailure = makeUsageFailure({
    message: `--days must be a whole number from 1 to ${MAX_SYNC_DAYS}.`,
  });
  return Effect.fail(daysFailure);
};

const describeAppFeed = (appFeed: AppFeedSyncReport): string => {
  const hasMessage = appFeed.message !== null;
  if (hasMessage) {
    return `${appFeed.appKey} ${appFeed.feed}: ${appFeed.status} (${appFeed.message})`;
  }
  return `${appFeed.appKey} ${appFeed.feed}: ${appFeed.status}`;
};

const pickAppName = (appFlag: string | undefined): string | null => {
  const isAppFlagMissing = appFlag === undefined;
  if (isAppFlagMissing) return null;
  return appFlag;
};

export const statsSyncProgram = (
  request: StatsSyncCommandRequest,
): Effect.Effect<void, CommandExit | StatsSyncCommandFailure, StatsSyncRequirements | Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const days = yield* parseDaysFlag(request.days);
    const appName = pickAppName(request.app);
    const report = yield* syncStats({ appName, days }).pipe(
      Effect.catchTag('StatsAppNotFoundFailure', (notFound) => {
        const notFoundFailure = makeUsageFailure({ message: notFound.message });
        return Effect.fail(notFoundFailure);
      }),
    );
    const isHumanOutput = !request.isJson;
    if (request.isJson) {
      const reportLine = JSON.stringify({ ok: true, ...report });
      yield* logger.line(reportLine).pipe(Effect.orDie);
    }
    if (isHumanOutput) {
      for (const appFeed of report.appFeeds) {
        yield* logger.line(describeAppFeed(appFeed)).pipe(Effect.orDie);
      }
    }
    const hasFeedFailed = report.appFeeds.some((appFeed) => appFeed.status === 'failed');
    if (hasFeedFailed) {
      const failedFeedExit = makeCommandExit({
        exitCode: FAILED_FEED_EXIT_CODE,
        message: 'At least one stats feed failed.',
      });
      return yield* Effect.fail(failedFeedExit);
    }
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.isJson),
    ),
  );
