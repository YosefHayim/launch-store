import { loadConfig } from '../config/config.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import {
  createAscClientResolver,
  createPlayClientResolver,
} from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type {
  AppReadiness,
  ProbeReport,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessStore,
} from '../types/readiness.ts';
import { READINESS_EXIT, runProbes } from './orchestrator.ts';
import { registerBuiltinProbes, selectReadinessProbes } from './registry.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type ReadinessCategory = 'account' | 'iap' | 'listing' | 'privacy' | 'signing' | 'submit';

type ReadinessReportLabels = Readonly<{
  summary: string;
  empty: string;
}>;

type ReadinessCommandInput = Readonly<{
  category: ReadinessCategory;
  labels: ReadinessReportLabels;
  app: string | null;
  json: boolean;
}>;

type ReadinessCommandFailure = Readonly<{
  _tag: 'ReadinessCommandFailure';
  operation: string;
  message: string;
  cause?: unknown;
}>;

const readinessStores: readonly ReadinessStore[] = ['appstore', 'play'];

const storeLabels: Readonly<Record<ReadinessStore, string>> = {
  appstore: 'App Store',
  play: 'Google Play',
};

const readinessCategories: readonly ReadinessCategory[] = [
  'account',
  'iap',
  'listing',
  'privacy',
  'signing',
  'submit',
];

function makeReadinessCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): ReadinessCommandFailure {
  return { _tag: 'ReadinessCommandFailure', ...fields };
}

function commandFailure(operation: string, cause: unknown): ReadinessCommandFailure {
  return makeReadinessCommandFailure({
    operation,
    message: errorMessage(cause),
    cause,
  });
}

function isReadinessCommandFailure(cause: unknown): cause is ReadinessCommandFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'ReadinessCommandFailure';
}

function isReadinessCategory(candidate: unknown): candidate is ReadinessCategory {
  if (typeof candidate != 'string') {
    return false;
  }

  function isThisCategory(category: ReadinessCategory): boolean {
    return category == candidate;
  }

  return readinessCategories.some(isThisCategory);
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isString = typeof field == 'string';

  if (isString == false) {
    throw commandFailure('decode readiness command', `Expected ${fieldName} to be a string.`);
  }

  return field;
}

function readOptionalString(record: Record<string, unknown>, fieldName: string): string | null {
  const isAbsent = Object.hasOwn(record, fieldName) == false;

  if (isAbsent) {
    return null;
  }

  return readRequiredString(record, fieldName);
}

function readOptionalBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const isAbsent = Object.hasOwn(record, fieldName) == false;

  if (isAbsent) {
    return false;
  }

  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw commandFailure('decode readiness command', `Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

function readReadinessCategory(candidate: unknown): ReadinessCategory {
  if (isReadinessCategory(candidate)) {
    return candidate;
  }

  throw commandFailure('decode readiness command', 'Readiness category is not recognized.');
}

function decodeReadinessCommandInput(rawCommandInput: unknown): ReadinessCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw commandFailure('decode readiness command', 'Readiness command input must be an object.');
  }

  const category = readReadinessCategory(rawCommandInputObject['category']);
  const labelsField = rawCommandInputObject['labels'];
  const labelsFieldObject = readPlainObject(labelsField);

  if (labelsFieldObject == null) {
    throw commandFailure('decode readiness command', 'Readiness labels must be an object.');
  }

  return {
    category,
    labels: {
      summary: readRequiredString(labelsFieldObject, 'summary'),
      empty: readRequiredString(labelsFieldObject, 'empty'),
    },
    app: readOptionalString(rawCommandInputObject, 'app'),
    json: readOptionalBoolean(rawCommandInputObject, 'json'),
  };
}

/** Human store name for a report header. */
export function readinessStoreLabel(store: ReadinessStore): string {
  return storeLabels[store];
}

/** Build the human summary detail after probe tallies (without the command-specific prefix). */
export function formatReadinessSummaryDetail(readinessOutcome: ReadinessOutcome): string {
  const summaryParts: string[] = [];
  const hasBlockers = readinessOutcome.blockerCount > 0;

  if (hasBlockers) {
    summaryParts.push(`${readinessOutcome.blockerCount} blocker(s)`);
  }

  const hasUnreadable = readinessOutcome.errorCount > 0;

  if (hasUnreadable) {
    summaryParts.push(`${readinessOutcome.errorCount} unreadable`);
  }

  const hasWarnings = readinessOutcome.warnCount > 0;

  if (hasWarnings) {
    summaryParts.push(`${readinessOutcome.warnCount} warning(s)`);
  }

  const hasSkipped = readinessOutcome.skippedCount > 0;

  if (hasSkipped) {
    summaryParts.push(`${readinessOutcome.skippedCount} skipped`);
  }

  const isAllClear = summaryParts.length == 0;

  if (isAllClear) {
    return 'all clear';
  }

  return summaryParts.join(' - ');
}

function writeOptionalHint(hint: string | undefined, logger: Logger): void {
  const isHintMissing = hint == null;

  if (isHintMissing) {
    return;
  }

  logger.tip(hint);
}

function renderAppReadiness(logger: Logger, title: string, appReadiness: AppReadiness): void {
  const reportLine = `${title} - ${appReadiness.app}: ${appReadiness.detail}`;

  switch (appReadiness.status) {
    case 'ok':
      logger.step(title, `${appReadiness.app}: ${appReadiness.detail}`);
      return;
    case 'warn':
      logger.warn(reportLine);
      writeOptionalHint(appReadiness.hint, logger);
      return;
    case 'blocker':
      logger.error(reportLine);
      writeOptionalHint(appReadiness.hint, logger);
      return;
  }
}

function renderProbeReport(logger: Logger, probeReport: ProbeReport): void {
  const { outcome, title } = probeReport;

  switch (outcome.state) {
    case 'skipped':
      logger.warn(`${title}: skipped - ${outcome.reason}`);
      writeOptionalHint(outcome.hint, logger);
      return;
    case 'errored':
      logger.error(`${title}: ${outcome.error}`);
      return;
    case 'checked':
      for (const appReadiness of outcome.apps) {
        renderAppReadiness(logger, title, appReadiness);
      }
      return;
    case 'omitted':
      return;
  }
}

function belongsToStore(store: ReadinessStore) {
  return function isStoreReport(probeReport: ProbeReport): boolean {
    return probeReport.store == store;
  };
}

function renderReadinessOutcome(
  logger: Logger,
  readinessOutcome: ReadinessOutcome,
  labels: ReadinessReportLabels,
): void {
  const isReportEmpty = readinessOutcome.reports.length == 0;

  if (isReportEmpty) {
    logger.note(labels.empty);
    return;
  }

  for (const store of readinessStores) {
    const storeReports = readinessOutcome.reports.filter(belongsToStore(store));
    const isStoreEmpty = storeReports.length == 0;

    if (isStoreEmpty) {
      continue;
    }

    logger.note(readinessStoreLabel(store));

    for (const probeReport of storeReports) {
      renderProbeReport(logger, probeReport);
    }
  }

  logger.gap();
  const summary = `${labels.summary}: ${formatReadinessSummaryDetail(readinessOutcome)}`;
  const isClear = readinessOutcome.exitCode == READINESS_EXIT.ok;

  if (isClear) {
    logger.note(summary);
    return;
  }

  logger.error(summary);
}

/** Run the selected readiness probe family and emit its human or JSON report. */
export async function readinessCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeReadinessCommandInput(rawCommandInput);
    const launchDirectories = readLaunchDirectories();
    const logger = createLogger(false);
    registerBuiltinProbes();
    const loadedConfiguration = await loadConfig(launchDirectories.workingDirectory);
    const selectedApps = await selectApps(loadedConfiguration.apps, commandInput.app ?? undefined);
    const resolveAscClient = createAscClientResolver();
    const ascClient = await resolveAscClient();
    const resolvePlayClient = await createPlayClientResolver();

    const readinessContext: ReadinessContext = {
      config: loadedConfiguration.config,
      apps: selectedApps,
      resolveAscApi: async function resolveAscApi() {
        return ascClient;
      },
      resolvePlayApi: resolvePlayClient,
    };
    const readinessOutcome = await runProbes(
      readinessContext,
      selectReadinessProbes(commandInput.category),
    );
    const isJson = commandInput.json == true;

    if (isJson) {
      logger.line(JSON.stringify(readinessOutcome, null, 2));
    } else {
      renderReadinessOutcome(logger, readinessOutcome, commandInput.labels);
    }

    completeCommand(readinessOutcome.exitCode);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isReadinessCommandFailure(cause)) {
      throw cause;
    }

    throw commandFailure('run readiness checks', cause);
  }
}
