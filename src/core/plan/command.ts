import type { FileSystem, Path } from '@effect/platform';
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
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { PlanContext, PlanStore, SurfacePlan, SurfacePlanner } from '../types/plan.js';
import type { PlannedAction } from '../types/reconcile.js';
import { PLAN_EXIT, runPlanners, type PlanOutcome } from './orchestrator.js';
import { listSurfacePlanners, registerBuiltinPlanners } from './registry.js';

export const PlanCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('plan', 'drift'),
  surface: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  check: Schema.Boolean,
  json: Schema.Boolean,
});

export type PlanCommandInput = Schema.Schema.Type<typeof PlanCommandInputSchema>;

export const PlanCommandFailureSchema = Schema.Struct({
  _tag: Schema.Literal('PlanCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

export type PlanCommandFailure = Schema.Schema.Type<typeof PlanCommandFailureSchema>;
export const makePlanCommandFailure = Data.tagged<PlanCommandFailure>('PlanCommandFailure');

type PlannedAppSurface = Extract<SurfacePlan, { state: 'planned'; scope: 'app' }>;
type PlannedTeamSurface = Extract<SurfacePlan, { state: 'planned'; scope: 'team' }>;

type PlanCommandRequirements =
  | AppleStoreClientService
  | FileSystem.FileSystem
  | GoogleStoreClientService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Logger
  | Path.Path;

const commandFailure = (operation: string, cause: unknown): PlanCommandFailure =>
  makePlanCommandFailure({ operation, message: errorMessage(cause), cause });

const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, PlanCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => commandFailure(operation, cause)));

/** ASCII action marker for plan report lines. */
export const planGlyph = (plannedAction: PlannedAction): string => {
  if (plannedAction.status === 'skipped') return '-';
  if (plannedAction.destructive) return '-';
  if (/^update\b/i.test(plannedAction.description)) return '~';
  return '+';
};

/** Caveat shown under additive surfaces (portal-side extras are invisible). */
export const additiveNote = (surfaceName: string): string =>
  `-> ${surfaceName} is additive - detects missing items, not portal-side additions (drift != "live == config")`;

const storeLabel = (planStore: PlanStore): string => {
  if (planStore === 'appstore') return 'App Store';
  return 'Google Play';
};

const renderActionLine = (plannedAction: PlannedAction): string =>
  `${planGlyph(plannedAction)} ${plannedAction.description}`;

const renderAppSurface = (
  logger: Logger,
  plannedSurface: PlannedAppSurface,
): Effect.Effect<void, PlanCommandFailure> =>
  Effect.gen(function* () {
    for (const appPlan of plannedSurface.apps) {
      const heading = `${appPlan.app} - ${plannedSurface.surface} (${appPlan.identifier})`;
      if (appPlan.error !== undefined) {
        yield* writeLog('render plan app error', logger.error(`${heading}: ${appPlan.error}`));
        continue;
      }
      if (appPlan.actions.length === 0) {
        yield* writeLog(
          'render synchronized plan app',
          logger.step(`${appPlan.app} - ${plannedSurface.surface}`, 'in sync'),
        );
        continue;
      }
      yield* writeLog(
        'render plan app actions',
        logger.notice(heading, ...appPlan.actions.map(renderActionLine)),
      );
    }
  });

const renderTeamSurface = (
  logger: Logger,
  plannedSurface: PlannedTeamSurface,
): Effect.Effect<void, PlanCommandFailure> =>
  Effect.gen(function* () {
    if (plannedSurface.actions.length === 0) {
      yield* writeLog(
        'render synchronized team plan',
        logger.step(`Team - ${plannedSurface.surface}`, 'in sync'),
      );
      return;
    }
    yield* writeLog(
      'render team plan actions',
      logger.notice(
        `${storeLabel(plannedSurface.store)} - Team - ${plannedSurface.surface}`,
        ...plannedSurface.actions.map(renderActionLine),
      ),
    );
  });

const renderSummary = (
  logger: Logger,
  planOutcome: PlanOutcome,
): Effect.Effect<void, PlanCommandFailure> =>
  Effect.gen(function* () {
    const { changeCount, appErrorCount, skippedSurfaceCount } = planOutcome;
    if (changeCount === 0 && appErrorCount === 0 && skippedSurfaceCount === 0) {
      yield* writeLog(
        'render synchronized plan summary',
        logger.step('plan', 'everything matches - no drift'),
      );
      return;
    }
    const summaryParts: string[] = [];
    if (changeCount > 0) summaryParts.push(`${changeCount} change(s)`);
    if (appErrorCount > 0) summaryParts.push(`${appErrorCount} error(s)`);
    if (skippedSurfaceCount > 0) summaryParts.push(`${skippedSurfaceCount} skipped`);
    yield* writeLog('render plan summary', logger.note(summaryParts.join(' - ')));
    if (planOutcome.check) {
      if (planOutcome.exitCode === PLAN_EXIT.error) {
        yield* writeLog(
          'render plan error guidance',
          logger.error(
            'Drift check could not certify - resolve the errors/credentials above, then re-run.',
          ),
        );
        return;
      }
      if (planOutcome.exitCode === PLAN_EXIT.drift) {
        yield* writeLog(
          'render plan drift guidance',
          logger.note('Drift detected. Run `launch sync` to reconcile.'),
        );
      }
      return;
    }
    yield* writeLog(
      'render plan guidance',
      logger.note('Run `launch sync` to apply, or `launch drift` to gate this in CI.'),
    );
  });

/** Render human plan/drift report lines for one outcome. */
export const renderPlanOutcome = (
  logger: Logger,
  planOutcome: PlanOutcome,
): Effect.Effect<void, PlanCommandFailure> =>
  Effect.gen(function* () {
    yield* writeLog('open plan report', logger.gap());
    if (planOutcome.surfaces.length === 0) {
      yield* writeLog(
        'render empty plan report',
        logger.note(
          'Nothing declared to plan - add products, capabilities, or a store.config.json listing, then re-run.',
        ),
      );
      return;
    }
    for (const plannedSurface of planOutcome.surfaces) {
      if (plannedSurface.state === 'skipped') {
        let hint = '';
        if (plannedSurface.hint !== undefined) hint = ` (${plannedSurface.hint})`;
        yield* writeLog(
          'render skipped plan surface',
          logger.warn(
            `${storeLabel(plannedSurface.store)} - ${plannedSurface.surface}: skipped - ${plannedSurface.reason}${hint}`,
          ),
        );
        continue;
      }
      if (plannedSurface.scope === 'team') yield* renderTeamSurface(logger, plannedSurface);
      else yield* renderAppSurface(logger, plannedSurface);
      if (plannedSurface.direction === 'additive') {
        yield* writeLog(
          'render additive plan caveat',
          logger.note(additiveNote(plannedSurface.surface)),
        );
      }
    }
    yield* writeLog('separate plan summary', logger.gap());
    yield* renderSummary(logger, planOutcome);
  });

/** Narrow registered planners to an optional surface id. */
export const selectPlanPlanners = (
  registeredPlanners: readonly SurfacePlanner[],
  surfaceName: string | undefined,
): Effect.Effect<SurfacePlanner[], PlanCommandFailure> => {
  if (surfaceName === undefined) return Effect.succeed([...registeredPlanners]);
  const selectedPlanner = registeredPlanners.find(
    (registeredPlanner) => registeredPlanner.id === surfaceName,
  );
  if (selectedPlanner !== undefined) return Effect.succeed([selectedPlanner]);
  let availableSurfaces = registeredPlanners
    .map((registeredPlanner) => registeredPlanner.id)
    .join(', ');
  if (availableSurfaces.length === 0) availableSurfaces = 'none';
  return Effect.fail(
    commandFailure(
      'select plan surface',
      `Unknown surface "${surfaceName}". Available: ${availableSurfaces}.`,
    ),
  );
};

/** Load config, resolve store clients once, run planners, and print or emit JSON. */
export const planCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | PlanCommandFailure, PlanCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(PlanCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    yield* Effect.sync(registerBuiltinPlanners);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectApps(loadedConfiguration.apps, commandInput.app).pipe(
      Effect.mapError((cause) => commandFailure('select plan apps', cause)),
    );
    const selectedPlanners = yield* selectPlanPlanners(listSurfacePlanners(), commandInput.surface);
    let check = commandInput.check;
    if (commandInput.operation === 'drift') check = true;
    const ascClient = yield* createAscClientResolver()();
    const playClient = yield* createPlayClientResolver()();
    const planContext: PlanContext = {
      config: loadedConfiguration.config,
      apps: selectedApps,
      resolveAscApi: () => Effect.succeed(ascClient),
      resolvePlayApi: () => Effect.succeed(playClient),
    };
    const planOutcome = yield* runPlanners(planContext, selectedPlanners, { check });
    if (commandInput.json === true) {
      yield* writeLog('render plan JSON', logger.line(JSON.stringify(planOutcome, null, 2)));
    } else {
      yield* renderPlanOutcome(logger, planOutcome);
    }
    yield* completeCommand(planOutcome.exitCode);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(PlanCommandFailureSchema)(cause)) return cause;
      return commandFailure('run plan command', cause);
    }),
  );
