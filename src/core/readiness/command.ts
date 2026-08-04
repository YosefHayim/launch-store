import type { FileSystem, HttpClient, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import type { AppleStoreClientService } from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import type { GoogleStoreClientService } from '../services/googleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { createAscClientResolver, createPlayClientResolver } from '../store/storeClients.js';
import { selectApps } from '../store/syncJobs.js';
import type {
  ProbeReport,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessStore,
} from '../types/readiness.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import { READINESS_EXIT, runProbes } from './orchestrator.js';
import { registerBuiltinProbes, selectReadinessProbes } from './registry.js';

/** The two strings that let each readiness command keep its own terminal voice. */
export type ReadinessReportLabels = Readonly<{
  readonly summary: string;
  readonly empty: string;
}>;

/** Shared input for audit, store doctor, and IAP doctor. */
export const ReadinessCommandInputSchema = Schema.Struct({
  category: Schema.Literal('account', 'iap', 'listing', 'privacy', 'signing', 'submit'),
  labels: Schema.Struct({
    summary: Schema.String,
    empty: Schema.String,
  }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  json: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export type ReadinessCommandInput = Schema.Schema.Type<typeof ReadinessCommandInputSchema>;

/** A configuration or store-client read failed before the probes could report readiness. */
export type ReadinessCommandFailure = Readonly<{
  readonly _tag: 'ReadinessCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeReadinessCommandFailure =
  Data.tagged<ReadinessCommandFailure>('ReadinessCommandFailure');

type ReadinessCommandRequirements =
  | AppleStoreClientService
  | FileSystem.FileSystem
  | GoogleStoreClientService
  | HttpClient.HttpClient
  | LaunchPathsService
  | LaunchSecretStoreService
  | Logger
  | Path.Path;

/** Convert an unknown command dependency failure into the readiness command's tagged failure. */
const commandFailure = (operation: string, cause: unknown): ReadinessCommandFailure => {
  return makeReadinessCommandFailure({
    operation,
    message: errorMessage(cause),
    cause,
  });
};

/** Map one terminal write into the readiness command's failure channel. */
const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, ReadinessCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => commandFailure(operation, cause)));

/** Human store name for a report header. */
const storeLabel = (store: ReadinessStore): string => {
  if (store === 'appstore') return 'App Store';
  return 'Google Play';
};

/** Render one probe's report through the shared terminal logger. */
const renderProbeReport = (
  logger: Logger,
  probeReport: ProbeReport,
): Effect.Effect<void, ReadinessCommandFailure> =>
  Effect.gen(function* () {
    const { outcome, title } = probeReport;
    if (outcome.state === 'skipped') {
      yield* writeLog(
        'render skipped readiness probe',
        logger.warn(`${title}: skipped - ${outcome.reason}`),
      );
      if (outcome.hint !== undefined)
        yield* writeLog('render readiness probe hint', logger.tip(outcome.hint));
      return;
    }
    if (outcome.state === 'errored') {
      yield* writeLog(
        'render unreadable readiness probe',
        logger.error(`${title}: ${outcome.error}`),
      );
      return;
    }
    if (outcome.state !== 'checked') return;
    for (const appReadiness of outcome.apps) {
      const reportLine = `${title} - ${appReadiness.app}: ${appReadiness.detail}`;
      switch (appReadiness.status) {
        case 'ok':
          yield* writeLog(
            'render clear readiness probe',
            logger.step(title, `${appReadiness.app}: ${appReadiness.detail}`),
          );
          break;
        case 'warn':
          yield* writeLog('render readiness warning', logger.warn(reportLine));
          if (appReadiness.hint !== undefined)
            yield* writeLog('render readiness warning hint', logger.tip(appReadiness.hint));
          break;
        case 'blocker':
          yield* writeLog('render readiness blocker', logger.error(reportLine));
          if (appReadiness.hint !== undefined)
            yield* writeLog('render readiness blocker hint', logger.tip(appReadiness.hint));
          break;
      }
    }
  });

/** Render a readiness outcome grouped by store with its command-specific summary. */
export const renderReadinessOutcome = (
  logger: Logger,
  readinessOutcome: ReadinessOutcome,
  labels: ReadinessReportLabels,
): Effect.Effect<void, ReadinessCommandFailure> =>
  Effect.gen(function* () {
    if (readinessOutcome.reports.length === 0) {
      yield* writeLog('render empty readiness report', logger.note(labels.empty));
      return;
    }
    for (const store of ['appstore', 'play'] as const) {
      const storeReports = readinessOutcome.reports.filter(
        (probeReport) => probeReport.store === store,
      );
      if (storeReports.length === 0) continue;
      yield* writeLog('render readiness store', logger.note(storeLabel(store)));
      for (const probeReport of storeReports) yield* renderProbeReport(logger, probeReport);
    }
    const summaryParts: string[] = [];
    if (readinessOutcome.blockerCount > 0)
      summaryParts.push(`${readinessOutcome.blockerCount} blocker(s)`);
    if (readinessOutcome.errorCount > 0)
      summaryParts.push(`${readinessOutcome.errorCount} unreadable`);
    if (readinessOutcome.warnCount > 0)
      summaryParts.push(`${readinessOutcome.warnCount} warning(s)`);
    if (readinessOutcome.skippedCount > 0)
      summaryParts.push(`${readinessOutcome.skippedCount} skipped`);
    yield* writeLog('render readiness summary', logger.gap());
    let summaryDetail = 'all clear';
    if (summaryParts.length > 0) summaryDetail = summaryParts.join(' - ');
    const summary = `${labels.summary}: ${summaryDetail}`;
    if (readinessOutcome.exitCode === READINESS_EXIT.ok)
      yield* writeLog('render clear readiness summary', logger.note(summary));
    else yield* writeLog('render blocked readiness summary', logger.error(summary));
  });

/** Run the selected readiness probe family and emit its human or JSON report. */
export const readinessCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | ReadinessCommandFailure, ReadinessCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ReadinessCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    yield* Effect.sync(registerBuiltinProbes);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectApps(loadedConfiguration.apps, commandInput.app);
    const ascClient = yield* createAscClientResolver()();
    const playClient = yield* createPlayClientResolver()();
    const readinessContext: ReadinessContext = {
      config: loadedConfiguration.config,
      apps: selectedApps,
      resolveAscApi: () => Effect.succeed(ascClient),
      resolvePlayApi: () => Effect.succeed(playClient),
    };
    const readinessOutcome = yield* runProbes(
      readinessContext,
      selectReadinessProbes(commandInput.category),
    );
    if (commandInput.json === true)
      yield* writeLog(
        'render readiness JSON',
        logger.line(JSON.stringify(readinessOutcome, null, 2)),
      );
    else yield* renderReadinessOutcome(logger, readinessOutcome, commandInput.labels);
    yield* completeCommand(readinessOutcome.exitCode);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      return commandFailure('run readiness checks', cause);
    }),
  );
