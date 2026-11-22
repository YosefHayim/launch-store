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
import type { AppDescriptor } from '../types/app.ts';
import type { PlanContext, PlanStore, SurfacePlan, SurfacePlanner } from '../types/plan.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { PLAN_EXIT, runPlanners, type PlanOutcome } from './orchestrator.ts';
import { listSurfacePlanners, registerBuiltinPlanners } from './registry.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type PlanCommandInput = Readonly<{
  operation: 'plan' | 'drift';
  surface?: string;
  app?: string;
  check: boolean;
  json: boolean;
}>;

export type PlanCommandFailure = Readonly<{
  _tag: 'PlanCommandFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

type PlannedAppSurface = Extract<SurfacePlan, { state: 'planned'; scope: 'app' }>;
type PlannedTeamSurface = Extract<SurfacePlan, { state: 'planned'; scope: 'team' }>;

function makePlanCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): PlanCommandFailure {
  return { _tag: 'PlanCommandFailure', ...fields };
}

function commandFailure(operation: string, cause: unknown): PlanCommandFailure {
  return makePlanCommandFailure({ operation, message: errorMessage(cause), cause });
}

export function isPlanCommandFailure(cause: unknown): cause is PlanCommandFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'PlanCommandFailure';
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw commandFailure('decode plan command', `Expected ${fieldName} to be a boolean.`);
  }

  return field;
}

function readPlanOperation(operationField: unknown): PlanCommandInput['operation'] {
  const isPlan = operationField == 'plan';

  if (isPlan) {
    return 'plan';
  }

  const isDrift = operationField == 'drift';

  if (isDrift) {
    return 'drift';
  }

  throw commandFailure('decode plan command', 'Plan operation must be plan or drift.');
}

function readOptionalString(record: Record<string, unknown>, fieldName: string): string | null {
  const isAbsent = Object.hasOwn(record, fieldName) == false;

  if (isAbsent) {
    return null;
  }

  const field = record[fieldName];
  const isString = typeof field == 'string';

  if (isString == false) {
    throw commandFailure('decode plan command', `Expected ${fieldName} to be a string.`);
  }

  return field;
}

export function decodePlanCommandInput(rawCommandInput: unknown): PlanCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw commandFailure('decode plan command', 'Plan command input must be an object.');
  }

  const operation = readPlanOperation(rawCommandInputObject['operation']);
  let commandInput: PlanCommandInput = {
    operation,
    check: readRequiredBoolean(rawCommandInputObject, 'check'),
    json: readRequiredBoolean(rawCommandInputObject, 'json'),
  };
  const surface = readOptionalString(rawCommandInputObject, 'surface');
  const app = readOptionalString(rawCommandInputObject, 'app');
  const hasSurface = surface != null;

  if (hasSurface) {
    commandInput = { ...commandInput, surface };
  }

  const hasApp = app != null;

  if (hasApp) {
    commandInput = { ...commandInput, app };
  }

  return commandInput;
}

/** ASCII action marker for plan report lines. */
export function planGlyph(plannedAction: PlannedAction): string {
  const isSkipped = plannedAction.status == 'skipped';

  if (isSkipped) {
    return '-';
  }

  const isDestructive = plannedAction.destructive == true;

  if (isDestructive) {
    return '-';
  }

  // Matches a description that starts with the word "update"
  const isUpdate = /^update\b/i.test(plannedAction.description);

  if (isUpdate) {
    return '~';
  }

  return '+';
}

/** Caveat shown under additive surfaces (portal-side extras are invisible). */
export function additiveNote(surfaceName: string): string {
  return `-> ${surfaceName} is additive - detects missing items, not portal-side additions (drift != "live == config")`;
}

function storeLabel(planStore: PlanStore): string {
  const isAppStore = planStore == 'appstore';

  if (isAppStore) {
    return 'App Store';
  }

  return 'Google Play';
}

function renderActionLine(plannedAction: PlannedAction): string {
  return `${planGlyph(plannedAction)} ${plannedAction.description}`;
}

function renderAppSurface(logger: Logger, plannedSurface: PlannedAppSurface): void {
  for (const appPlan of plannedSurface.apps) {
    const heading = `${appPlan.app} - ${plannedSurface.surface} (${appPlan.identifier})`;
    const hasError = appPlan.error != null;

    if (hasError) {
      logger.error(`${heading}: ${appPlan.error}`);
      continue;
    }

    const isInSync = appPlan.actions.length == 0;

    if (isInSync) {
      logger.step(`${appPlan.app} - ${plannedSurface.surface}`, 'in sync');
      continue;
    }

    const actionLines = appPlan.actions.map(renderActionLine);
    logger.notice(heading, ...actionLines);
  }
}

function renderTeamSurface(logger: Logger, plannedSurface: PlannedTeamSurface): void {
  const isInSync = plannedSurface.actions.length == 0;

  if (isInSync) {
    logger.step(`Team - ${plannedSurface.surface}`, 'in sync');
    return;
  }

  const actionLines = plannedSurface.actions.map(renderActionLine);
  logger.notice(
    `${storeLabel(plannedSurface.store)} - Team - ${plannedSurface.surface}`,
    ...actionLines,
  );
}

function isZeroCount(count: number): boolean {
  return count == 0;
}

function renderSummary(logger: Logger, planOutcome: PlanOutcome): void {
  const { changeCount, appErrorCount, skippedSurfaceCount } = planOutcome;
  const isClean = [changeCount, appErrorCount, skippedSurfaceCount].every(isZeroCount);

  if (isClean) {
    logger.step('plan', 'everything matches - no drift');
    return;
  }

  const summaryParts: string[] = [];
  const hasChanges = changeCount > 0;

  if (hasChanges) {
    summaryParts.push(`${changeCount} change(s)`);
  }

  const hasErrors = appErrorCount > 0;

  if (hasErrors) {
    summaryParts.push(`${appErrorCount} error(s)`);
  }

  const hasSkips = skippedSurfaceCount > 0;

  if (hasSkips) {
    summaryParts.push(`${skippedSurfaceCount} skipped`);
  }

  logger.note(summaryParts.join(' - '));
  const isCheck = planOutcome.check == true;

  if (isCheck == false) {
    logger.note('Run `launch sync` to apply, or `launch drift` to gate this in CI.');
    return;
  }

  const isErrorExit = planOutcome.exitCode == PLAN_EXIT.error;

  if (isErrorExit) {
    logger.error(
      'Drift check could not certify - resolve the errors/credentials above, then re-run.',
    );
    return;
  }

  const isDriftExit = planOutcome.exitCode == PLAN_EXIT.drift;

  if (isDriftExit) {
    logger.note('Drift detected. Run `launch sync` to reconcile.');
  }
}

/** Render human plan/drift report lines for one outcome. */
function renderPlanOutcome(logger: Logger, planOutcome: PlanOutcome): void {
  logger.gap();
  const isEmpty = planOutcome.surfaces.length == 0;

  if (isEmpty) {
    logger.note(
      'Nothing declared to plan - add products, capabilities, or a store.config.json listing, then re-run.',
    );
    return;
  }

  for (const plannedSurface of planOutcome.surfaces) {
    switch (plannedSurface.state) {
      case 'skipped': {
        let hint = '';
        const hasHint = plannedSurface.hint != null;

        if (hasHint) {
          hint = ` (${plannedSurface.hint})`;
        }

        logger.warn(
          `${storeLabel(plannedSurface.store)} - ${plannedSurface.surface}: skipped - ${plannedSurface.reason}${hint}`,
        );
        break;
      }
      case 'planned': {
        const isTeam = plannedSurface.scope == 'team';

        if (isTeam) {
          renderTeamSurface(logger, plannedSurface);
        }

        if (isTeam == false) {
          renderAppSurface(logger, plannedSurface);
        }

        const isAdditive = plannedSurface.direction == 'additive';

        if (isAdditive) {
          logger.note(additiveNote(plannedSurface.surface));
        }
        break;
      }
    }
  }

  logger.gap();
  renderSummary(logger, planOutcome);
}

function matchesSurface(surfaceName: string) {
  return function isSelectedPlanner(registeredPlanner: SurfacePlanner): boolean {
    return registeredPlanner.id == surfaceName;
  };
}

function plannerId(registeredPlanner: SurfacePlanner): string {
  return registeredPlanner.id;
}

/** Narrow registered planners to an optional surface id. */
export function selectPlanPlanners(
  registeredPlanners: readonly SurfacePlanner[],
  surfaceName: string | undefined,
): SurfacePlanner[] {
  const isEverySurface = surfaceName == null;

  if (isEverySurface) {
    return [...registeredPlanners];
  }

  const selectedPlanner = registeredPlanners.find(matchesSurface(surfaceName));
  const isKnownSurface = selectedPlanner != null;

  if (isKnownSurface) {
    return [selectedPlanner];
  }

  let availableSurfaces = registeredPlanners.map(plannerId).join(', ');
  const isNoneRegistered = availableSurfaces.length == 0;

  if (isNoneRegistered) {
    availableSurfaces = 'none';
  }

  throw commandFailure(
    'select plan surface',
    `Unknown surface "${surfaceName}". Available: ${availableSurfaces}.`,
  );
}

/** Load config, resolve store clients once, run planners, and print or emit JSON. */
export async function planCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodePlanCommandInput(rawCommandInput);
    const launchDirectories = readLaunchDirectories();
    const logger = createLogger(false);
    registerBuiltinPlanners();
    const loadedConfiguration = await loadConfig(launchDirectories.workingDirectory);

    let selectedApps: readonly AppDescriptor[];

    try {
      selectedApps = await selectApps(loadedConfiguration.apps, commandInput.app);
    } catch (cause) {
      throw commandFailure('select plan apps', cause);
    }

    const selectedPlanners = selectPlanPlanners(listSurfacePlanners(), commandInput.surface);
    let check = commandInput.check;
    const isDrift = commandInput.operation == 'drift';

    if (isDrift) {
      check = true;
    }

    const resolveAscClient = createAscClientResolver();
    const ascClient = await resolveAscClient();
    const resolvePlayClient = await createPlayClientResolver();
    const planContext: PlanContext = {
      config: loadedConfiguration.config,
      apps: selectedApps,
      resolveAscApi: async function resolveAscApi() {
        return ascClient;
      },
      resolvePlayApi: resolvePlayClient,
    };
    const planOutcome = await runPlanners(planContext, selectedPlanners, { check });
    const isJson = commandInput.json == true;

    if (isJson) {
      logger.line(JSON.stringify(planOutcome, null, 2));
    } else {
      renderPlanOutcome(logger, planOutcome);
    }

    completeCommand(planOutcome.exitCode);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    if (isPlanCommandFailure(cause)) {
      throw cause;
    }

    throw commandFailure('run plan command', cause);
  }
}
