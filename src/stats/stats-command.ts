import type { AppOwner, PortfolioPlatform } from '../types/portfolio.ts';
import { createLogger } from '../services/platform/logger.ts';
import { makeCommandExit } from '../terminal/command-exit.ts';
import { makeUsageFailure, type UsageFailure } from '../terminal/usage-failure.ts';
import type { AppStatsReport, StatsReport } from '../types/stats-report.ts';
import { parseDaysFlag } from './stats-sync-command.ts';
import { createStatsReport } from './stats-report.ts';
import { describeAppStats } from './stats-report-text.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

export interface StatsCommandRequest {
  readonly platform: string | undefined;
  readonly owner: string | undefined;
  readonly app: string | undefined;
  readonly days: string | undefined;
  readonly json: boolean;
}

function isUsageFailure(cause: unknown): cause is UsageFailure {
  return isFailureTag(cause, 'UsageFailure');
}

function isAppNotFound(cause: unknown): cause is { message: string } {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  if (cause._tag != 'StatsReportAppNotFoundFailure') {
    return false;
  }

  if ('message' in cause == false) {
    return false;
  }

  return typeof cause.message == 'string';
}

function finishUsageFailure(usageFailure: UsageFailure, isJson: boolean): never {
  const logger = createLogger(false);

  if (isJson) {
    const serialized = JSON.stringify({ ok: false, error: usageFailure.message });
    logger.line(serialized);
  }

  const isHumanOutput = isJson == false;

  if (isHumanOutput) {
    logger.error(usageFailure.message);
  }

  throw makeCommandExit({ exitCode: 2, message: usageFailure.message });
}

function readPlatformFlag(platformFlag: string | undefined): PortfolioPlatform | null {
  if (platformFlag == null) {
    return null;
  }

  if (platformFlag == 'ios') {
    return 'ios';
  }

  if (platformFlag == 'android') {
    return 'android';
  }

  throw makeUsageFailure({ message: '--platform must be ios or android.' });
}

function readOwnerFlag(ownerFlag: string | undefined): AppOwner | null {
  if (ownerFlag == null) {
    return null;
  }

  if (ownerFlag == 'mine') {
    return 'mine';
  }

  if (ownerFlag == 'client') {
    return 'client';
  }

  throw makeUsageFailure({ message: '--owner must be mine or client.' });
}

function readAppName(appText: string | undefined): string | null {
  if (appText == null) {
    return null;
  }

  return appText;
}

function showAppReport(appReport: AppStatsReport): void {
  const logger = createLogger(false);

  for (const line of describeAppStats(appReport)) {
    logger.line(line);
  }
}

function showReport(report: StatsReport): void {
  const logger = createLogger(false);

  const hasNoApps = report.apps.length == 0;

  if (hasNoApps) {
    logger.note('No apps found.');
  }

  for (const appReport of report.apps) {
    showAppReport(appReport);
  }

  if (report.isStale) {
    logger.warn(
      'Some numbers are old: a sync did not finish. Run `launch-store stats sync` to see why.',
    );
  }
}

/** `launch-store stats`: read the saved numbers of the apps, after refreshing the old ones. */
export async function statsReportProgram(request: StatsCommandRequest): Promise<void> {
  const logger = createLogger(false);

  try {
    const platform = readPlatformFlag(request.platform);
    const owner = readOwnerFlag(request.owner);
    const days = parseDaysFlag(request.days);
    const appName = readAppName(request.app);
    const report = await createStatsReport({
      platform,
      owner,
      appName: appName,
      days,
    });

    if (request.json) {
      const serialized = JSON.stringify({ ok: true, ...report });
      logger.line(serialized);
      return;
    }

    showReport(report);
  } catch (cause) {
    if (isAppNotFound(cause)) {
      const usageFailure = makeUsageFailure({ message: cause.message });
      throw finishUsageFailure(usageFailure, request.json);
    }

    if (isUsageFailure(cause)) {
      throw finishUsageFailure(cause, request.json);
    }

    throw cause;
  }
}
