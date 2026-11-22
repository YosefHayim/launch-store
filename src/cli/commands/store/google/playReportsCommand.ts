import {
  loadServiceAccount,
  describeMissingPlayServiceAccount,
} from '@/credentials/androidKeystore.js';
import { errorMessage } from '@/services/platform/errorMessage.js';
import { createLogger } from '@/services/platform/logger.js';
import { GoogleReportingClientService } from '@/services/stores/googleReportingClient.js';
import type { PlayVitalsMetric, VitalsTimeline } from '@/types/vitals.js';
import { selectStoreApp } from '@/store/shared/selectStoreApp.js';

/** Default Play vitals history window shown by the command. */
export const DEFAULT_VITALS_DAYS = 28;
/** Largest Play vitals history window accepted from the CLI. */
export const MAX_VITALS_DAYS = 365;

type PlayReportsCommandInput = {
  app?: string;
  metric?: string;
  days?: string;
  json: boolean;
};

type PlayReportsCommandFailure = Readonly<{
  readonly _tag: 'PlayReportsCommandFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

function makePlayReportsCommandFailure(fields: {
  message: string;
  cause?: unknown;
}): PlayReportsCommandFailure {
  return { _tag: 'PlayReportsCommandFailure', ...fields };
}

const METRIC_LABEL: Record<PlayVitalsMetric, string> = {
  crash: 'Crash rate',
  anr: 'ANR rate',
};

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readLooseOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field == 'undefined') {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function decodePlayReportsCommandInput(rawCommandInput: unknown): PlayReportsCommandInput {
  if (isRecord(rawCommandInput) == false) {
    throw new Error('Play reports command input must be an object.');
  }

  const commandInput: PlayReportsCommandInput = {
    json: readRequiredBoolean(rawCommandInput, 'json'),
  };
  const appName = readLooseOptionalString(rawCommandInput, 'app');
  const metricName = readLooseOptionalString(rawCommandInput, 'metric');
  const daysText = readLooseOptionalString(rawCommandInput, 'days');

  if (appName != null) {
    commandInput.app = appName;
  }

  if (metricName != null) {
    commandInput.metric = metricName;
  }

  if (daysText != null) {
    commandInput.days = daysText;
  }

  return commandInput;
}

export function parseVitalsMetrics(metricFlag: string | undefined): PlayVitalsMetric[] {
  if (metricFlag == null) {
    return ['crash', 'anr'];
  }

  const metricName = metricFlag.trim().toLowerCase();

  if (metricName == 'crash') {
    return ['crash'];
  }

  if (metricName == 'anr') {
    return ['anr'];
  }

  throw makePlayReportsCommandFailure({
    message: `--metric must be "crash" or "anr" (got "${metricFlag}").`,
  });
}

// Whole digits only, so "7.5" and "-3" are rejected before the range check.
const WHOLE_NUMBER_PATTERN = /^\d+$/;

export function parseVitalsDays(daysFlag: string | undefined): number {
  if (daysFlag == null) {
    return DEFAULT_VITALS_DAYS;
  }

  const trimmedDays = daysFlag.trim();
  const isWholeNumber = WHOLE_NUMBER_PATTERN.test(trimmedDays);

  if (isWholeNumber == false) {
    throw makePlayReportsCommandFailure({
      message: `--days must be a positive whole number (got "${daysFlag}").`,
    });
  }

  const historyDays = Number(trimmedDays);
  const isBelowOne = historyDays < 1;

  if (isBelowOne) {
    throw makePlayReportsCommandFailure({
      message: `--days must be a positive whole number (got "${daysFlag}").`,
    });
  }

  const isAboveMax = historyDays > MAX_VITALS_DAYS;

  if (isAboveMax) {
    throw makePlayReportsCommandFailure({
      message: `--days cannot exceed ${MAX_VITALS_DAYS} (got "${daysFlag}").`,
    });
  }

  return historyDays;
}

function percentage(rate: number | undefined): string {
  if (rate == null) {
    return '-';
  }

  return `${(rate * 100).toFixed(2)}%`;
}

function renderVitalsEntry(vitalsEntry: VitalsTimeline['rows'][number]): string {
  let usersText = '';

  if (vitalsEntry.distinctUsers != null) {
    usersText = `  ${vitalsEntry.distinctUsers} users`;
  }

  return `  ${vitalsEntry.date}  ${percentage(vitalsEntry.rate).padStart(7)}  (user-perceived ${percentage(vitalsEntry.userPerceivedRate)})${usersText}`;
}

function renderVitalsTimeline(timeline: VitalsTimeline): string {
  const header = `\n${METRIC_LABEL[timeline.metric]}  (${timeline.window.startDate} -> ${timeline.window.endDate}, DAILY)`;
  const hasNoRows = timeline.rows.length == 0;

  if (hasNoRows) {
    return `${header}\n  (no data - the app may be new, or below Play's reporting threshold)`;
  }

  const timelineLines = timeline.rows.map(renderVitalsEntry);

  return [header, ...timelineLines].join('\n');
}

function timelineText(timeline: VitalsTimeline): string {
  return renderVitalsTimeline(timeline);
}

export async function playReportsCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodePlayReportsCommandInput(rawCommandInput);
    const metrics = parseVitalsMetrics(commandInput.metric);
    const historyDays = parseVitalsDays(commandInput.days);
    const selectedApp = await selectStoreApp(commandInput.app);

    if (selectedApp.packageName == null) {
      throw makePlayReportsCommandFailure({
        message: `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
      });
    }

    const packageName = selectedApp.packageName;
    const serviceAccountJson = await loadServiceAccount(packageName);

    if (serviceAccountJson == null) {
      const missingMessage = await describeMissingPlayServiceAccount(selectedApp.name);

      throw makePlayReportsCommandFailure({ message: missingMessage });
    }

    const reportingClient = GoogleReportingClientService.createClient(serviceAccountJson);
    const timelineReads = metrics.map(function readTimeline(metric: PlayVitalsMetric) {
      return reportingClient.vitalsTimeline(packageName, metric, historyDays);
    });
    const timelines = await Promise.all(timelineReads);
    const logger = createLogger(false);

    if (commandInput.json) {
      const timelineRows = timelines.flatMap(function rowsOf(timeline: VitalsTimeline) {
        return timeline.rows;
      });

      logger.line(JSON.stringify(timelineRows, null, 2));
      return;
    }

    logger.line(timelines.map(timelineText).join('\n'));
  } catch (cause) {
    throw makePlayReportsCommandFailure({ message: errorMessage(cause), cause });
  }
}
