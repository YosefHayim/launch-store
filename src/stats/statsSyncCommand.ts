import { createLogger } from '../services/platform/logger.js';
import { makeCommandExit } from '../terminal/commandExit.js';
import { makeUsageFailure, type UsageFailure } from '../terminal/usageFailure.js';
import type { AppFeedSyncReport } from '../types/stats.js';
import type { DocumentFileFailure } from '../services/platform/atomicDocumentFile.js';
import type { InvalidAppKeyFailure } from '../services/platform/paths.js';
import { DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS } from './dateRange.js';
import { syncStats } from './syncStats.js';
import type { SyncLockFailure } from './syncLock.js';

interface StatsSyncCommandRequest {
  readonly app: string | undefined;
  readonly days: string | undefined;
  readonly isJson: boolean;
}

type StatsSyncCommandFailure = InvalidAppKeyFailure | DocumentFileFailure | SyncLockFailure;

// A whole number written with digits only.
const DAYS_PATTERN = /^[0-9]+$/;

function isUsageFailure(cause: unknown): cause is UsageFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'UsageFailure';
}

function isStatsAppNotFound(
  cause: unknown,
): cause is { _tag: 'StatsAppNotFoundFailure'; message: string } {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  if (cause._tag != 'StatsAppNotFoundFailure') {
    return false;
  }

  if ('message' in cause == false) {
    return false;
  }

  return typeof cause.message == 'string';
}

function finishUsageFailure(usageFailure: UsageFailure, isJson: boolean): never {
  const logger = createLogger(false);
  const isJsonOutput = isJson;

  if (isJsonOutput) {
    logger.line(JSON.stringify({ ok: false, error: usageFailure.message }));
  }

  const isHumanOutput = isJsonOutput == false;

  if (isHumanOutput) {
    logger.error(usageFailure.message);
  }

  throw makeCommandExit({ exitCode: 2, message: usageFailure.message });
}

function isDaysInRange(daysFlag: string): boolean {
  const isWholeNumber = DAYS_PATTERN.test(daysFlag);

  if (isWholeNumber == false) {
    return false;
  }

  const days = Number(daysFlag);
  const isBelowOne = days < 1;

  if (isBelowOne) {
    return false;
  }

  return days <= MAX_SYNC_DAYS;
}

export function parseDaysFlag(daysFlag: string | undefined): number {
  const isDaysFlagMissing = daysFlag == null;

  if (isDaysFlagMissing) {
    return DEFAULT_SYNC_DAYS;
  }

  const isFlagValid = isDaysInRange(daysFlag);

  if (isFlagValid) {
    return Number(daysFlag);
  }

  throw makeUsageFailure({
    message: `--days must be a whole number from 1 to ${MAX_SYNC_DAYS}.`,
  });
}

function describeAppFeed(appFeed: AppFeedSyncReport): string {
  const hasMessage = appFeed.message != null;

  if (hasMessage) {
    return `${appFeed.appKey} ${appFeed.feed}: ${appFeed.status} (${appFeed.message})`;
  }

  return `${appFeed.appKey} ${appFeed.feed}: ${appFeed.status}`;
}

function pickAppName(appFlag: string | undefined): string | null {
  const isAppFlagMissing = appFlag == null;

  if (isAppFlagMissing) {
    return null;
  }

  return appFlag;
}

function isFeedFailed(appFeed: AppFeedSyncReport): boolean {
  return appFeed.status == 'failed';
}

function readNotFoundMessage(cause: unknown): string | null {
  if (isStatsAppNotFound(cause) == false) {
    return null;
  }

  return cause.message;
}

export async function statsSyncProgram(request: StatsSyncCommandRequest): Promise<void> {
  const logger = createLogger(false);

  try {
    const days = parseDaysFlag(request.days);
    const appName = pickAppName(request.app);
    const report = await syncStats({ appName, days });
    const isHumanOutput = request.isJson == false;

    if (request.isJson) {
      logger.line(JSON.stringify({ ok: true, ...report }));
    }

    if (isHumanOutput) {
      for (const appFeed of report.appFeeds) {
        logger.line(describeAppFeed(appFeed));
      }
    }

    const hasFeedFailed = report.appFeeds.some(isFeedFailed);

    if (hasFeedFailed) {
      throw makeCommandExit({
        exitCode: 1,
        message: 'At least one stats feed failed.',
      });
    }
  } catch (cause) {
    const notFoundMessage = readNotFoundMessage(cause);

    if (notFoundMessage != null) {
      throw finishUsageFailure(makeUsageFailure({ message: notFoundMessage }), request.isJson);
    }

    if (isUsageFailure(cause)) {
      throw finishUsageFailure(cause, request.isJson);
    }

    throw cause;
  }
}

export type { StatsSyncCommandFailure, StatsSyncCommandRequest };
