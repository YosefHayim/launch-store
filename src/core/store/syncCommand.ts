import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Clock, Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import type { AppleStoreClientService } from '../services/appleStoreClient.js';
import type { GoogleStoreClientService } from '../services/googleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { captureAutoSnapshot } from '../snapshot/autoSnapshot.js';
import type { SnapshotContext } from '../types/snapshot.js';
import { buildJobs, selectApps, type SyncJob } from './syncJobs.js';
import { createAscClientResolver, createPlayClientResolver } from './storeClients.js';
import { reconcileJob, summarize, SYNC_CONCURRENCY, type JobOutcome } from './syncRun.js';

export const SyncCommandInputSchema = Schema.Struct({
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
  allowDestructive: Schema.Boolean,
  yes: Schema.Boolean,
  snapshot: Schema.Boolean,
});

export type SyncCommandInput = Schema.Schema.Type<typeof SyncCommandInputSchema>;

export type SyncCommandFailure = Readonly<{
  readonly _tag: 'SyncCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeSyncCommandFailure = Data.tagged<SyncCommandFailure>('SyncCommandFailure');

type SyncCommandRequirements =
  | AppleStoreClientService
  | FileSystem.FileSystem
  | GoogleStoreClientService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Mark a planned action as destructive or additive with plain ASCII. */
const actionMarker = (destructive: boolean): string => {
  if (destructive) return '-';
  return '+';
};

/** Count planned mutations and plan failures while rendering each application plan. */
const showPlans = (
  plans: readonly JobOutcome[],
): Effect.Effect<Readonly<{ mutationCount: number; planErrors: number }>, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    let mutationCount = 0;
    let planErrors = 0;
    yield* logger.gap();
    for (const plan of plans) {
      if ('error' in plan) {
        planErrors += 1;
        yield* logger.error(`${plan.job.app.name} (${plan.job.bundleId}): ${plan.error}`);
        continue;
      }
      const plannedActions = plan.report.actions;
      mutationCount += plannedActions.filter((action) => action.status === 'planned').length;
      if (plannedActions.length === 0) {
        yield* logger.skip(`${plan.job.app.name}: already in sync`);
        continue;
      }
      yield* logger.notice(
        `${plan.job.app.name} (${plan.job.bundleId})`,
        ...plannedActions.map((action) => {
          if (action.status === 'skipped') return `- ${action.description}`;
          return `${actionMarker(action.destructive)} ${action.description}`;
        }),
      );
    }
    return { mutationCount, planErrors };
  });

/** Return only jobs whose plan contains at least one pending mutation. */
const jobsWithPlannedChanges = (plans: readonly JobOutcome[]): SyncJob[] => {
  const jobsToApply: SyncJob[] = [];
  for (const plan of plans) {
    if (!('report' in plan)) continue;
    if (!plan.report.actions.some((action) => action.status === 'planned')) continue;
    jobsToApply.push(plan.job);
  }
  return jobsToApply;
};

/** Render apply outcomes and return their total failure count. */
const showAppliedOutcomes = (
  appliedOutcomes: readonly JobOutcome[],
  planErrors: number,
): Effect.Effect<number, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    let failures = planErrors;
    const receiptLines: string[] = [];
    for (const appliedOutcome of appliedOutcomes) {
      if ('error' in appliedOutcome) {
        failures += 1;
        receiptLines.push(`[ERROR] ${appliedOutcome.job.app.name}: ${appliedOutcome.error}`);
        continue;
      }
      const actionSummary = summarize(appliedOutcome.report);
      failures += actionSummary.failed;
      let statusMarker = '[OK]';
      if (actionSummary.failed > 0) statusMarker = '[ERROR]';
      receiptLines.push(
        `${statusMarker} ${appliedOutcome.job.app.name}: ${actionSummary.applied} applied, ${actionSummary.failed} failed, ${actionSummary.skipped} skipped`,
      );
      for (const action of appliedOutcome.report.actions) {
        if (action.status !== 'failed') continue;
        let failureText = action.error;
        if (failureText === undefined) failureText = 'failed';
        receiptLines.push(`  [ERROR] ${action.description} - ${failureText}`);
      }
    }
    let receiptTitle = 'Synced';
    if (failures > 0) receiptTitle = 'Synced with errors';
    yield* logger.box(receiptTitle, receiptLines);
    return failures;
  });

/** Confirm a write in an interactive terminal unless `--yes` was provided. */
const confirmSync = (
  mutationCount: number,
  assumeYes: boolean,
): Effect.Effect<void, SyncCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeSyncCommandFailure({
          operation: 'confirm sync',
          message: 'Refusing to apply without confirmation. Re-run with --yes or --dry-run.',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    if (yield* prompt.confirm(`Apply ${mutationCount} change(s) to App Store Connect?`)) return;
    return yield* Effect.fail(
      makeSyncCommandFailure({ operation: 'confirm sync', message: 'Sync was cancelled.' }),
    );
  }).pipe(
    Effect.mapError((cause) => {
      if (cause._tag === 'SyncCommandFailure') return cause;
      return makeSyncCommandFailure({
        operation: 'confirm sync',
        message: cause.message,
        cause,
      });
    }),
  );

/** Capture a best-effort pre-sync snapshot with already acquired store clients. */
const captureSyncBaseline = (
  config: SnapshotContext['config'],
  apps: SnapshotContext['apps'],
  resolveAscApi: SnapshotContext['resolveAscApi'],
  resolvePlayApi: SnapshotContext['resolvePlayApi'],
): Effect.Effect<void, never, FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const currentTime = yield* Clock.currentTimeMillis;
    const snapshotAttempt = yield* captureAutoSnapshot(
      { config, apps, resolveAscApi, resolvePlayApi },
      { capturedAt: new Date(currentTime).toISOString() },
    ).pipe(Effect.either);
    if (snapshotAttempt._tag === 'Left') {
      yield* logger.warn('Could not capture a pre-sync snapshot; continuing.');
      return;
    }
    yield* logger.ok(
      `Saved snapshot "${snapshotAttempt.right.name}" (${snapshotAttempt.right.entityCount} entries).`,
    );
  }).pipe(Effect.catchAll(() => Effect.void));

/** Decode and execute the two-pass store reconciliation command. */
export const syncCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, SyncCommandFailure, SyncCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(SyncCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectApps(loadedConfig.apps, commandInput.app);
    const jobs = yield* buildJobs(selectedApps, loadedConfig.config);
    const logger = yield* createLogger(false);
    if (jobs.length === 0) {
      yield* logger.skip('Nothing to sync for the selected applications.');
      return;
    }
    for (const syncJob of jobs) {
      if (syncJob.unmapped.length === 0) continue;
      yield* logger.warn(
        `${syncJob.app.name}: unrecognized entitlements: ${syncJob.unmapped.join(', ')}`,
      );
    }
    const resolveAscApi = createAscClientResolver();
    const ascClient = yield* resolveAscApi();
    if (ascClient === null) {
      return yield* Effect.fail(
        makeSyncCommandFailure({
          operation: 'connect to App Store Connect',
          message: 'No active Apple account. Run `launch creds set-key` first.',
        }),
      );
    }
    const plans = yield* Effect.forEach(
      jobs,
      (syncJob) => reconcileJob(ascClient, syncJob, true, commandInput.allowDestructive),
      { concurrency: SYNC_CONCURRENCY },
    );
    const planSummary = yield* showPlans(plans);
    if (planSummary.mutationCount === 0) {
      if (planSummary.planErrors > 0) {
        return yield* Effect.fail(
          makeSyncCommandFailure({
            operation: 'plan sync',
            message: `${planSummary.planErrors} application plan(s) failed.`,
          }),
        );
      }
      yield* logger.ok('Everything is already in sync.');
      return;
    }
    yield* logger.line(`${planSummary.mutationCount} change(s) across ${jobs.length} app(s).`);
    if (commandInput.dryRun) {
      yield* logger.ok('Dry run complete; no changes were made.');
      if (planSummary.planErrors > 0) {
        return yield* Effect.fail(
          makeSyncCommandFailure({
            operation: 'plan sync',
            message: `${planSummary.planErrors} application plan(s) failed.`,
          }),
        );
      }
      return;
    }
    yield* confirmSync(planSummary.mutationCount, commandInput.yes);
    if (commandInput.snapshot) {
      const playClient = yield* createPlayClientResolver()();
      yield* captureSyncBaseline(
        loadedConfig.config,
        selectedApps,
        () => Effect.succeed(ascClient),
        () => Effect.succeed(playClient),
      );
    }
    const appliedOutcomes = yield* Effect.forEach(
      jobsWithPlannedChanges(plans),
      (syncJob) => reconcileJob(ascClient, syncJob, false, commandInput.allowDestructive),
      { concurrency: SYNC_CONCURRENCY },
    );
    const failureCount = yield* showAppliedOutcomes(appliedOutcomes, planSummary.planErrors);
    if (failureCount > 0) {
      return yield* Effect.fail(
        makeSyncCommandFailure({
          operation: 'apply sync',
          message: `${failureCount} sync action(s) failed.`,
        }),
      );
    }
  }).pipe(
    Effect.mapError((cause) =>
      makeSyncCommandFailure({
        operation: 'run store sync',
        message: errorMessage(cause),
        cause,
      }),
    ),
  );
