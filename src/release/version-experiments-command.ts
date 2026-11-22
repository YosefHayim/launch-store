import type { LocalScreenshot } from '../listing/screenshots/assets.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from '../cli/commands/store/apple/app-store-surface-command.ts';
import { loadActiveAppleStore } from '../cli/commands/store/apple/apple-store-command.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  discoverTreatmentScreenshots,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
  summarizeExperiments,
  type VersionExperimentsConfig,
} from './version-experiments.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type VersionExperimentsCommandInput = {
  readonly app?: string;
  readonly config: string;
  readonly submit: boolean;
  readonly start: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
};

/** A version experiments command step failed. */
type VersionExperimentsCommandFailure = Readonly<{
  readonly _tag: 'VersionExperimentsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeVersionExperimentsCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): VersionExperimentsCommandFailure {
  return {
    _tag: 'VersionExperimentsCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function readBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'decode experiments command input',
      message: `Experiments command ${fieldName} must be a boolean.`,
      cause: record,
    });
  }

  return field;
}

function readAppSelector(record: Record<string, unknown>): string | undefined {
  const hasAppKey = Object.hasOwn(record, 'app');

  if (hasAppKey == false) {
    return undefined;
  }

  const appField = record['app'];
  const isAppText = typeof appField == 'string';

  if (isAppText == false) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'decode experiments command input',
      message: 'Experiments command app must be a string when it is present.',
      cause: record,
    });
  }

  return appField;
}

export function decodeVersionExperimentsCommandInput(
  rawCommandInput: unknown,
): VersionExperimentsCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'decode experiments command input',
      message: 'Experiments command input must be an object.',
      cause: rawCommandInput,
    });
  }

  const configField = rawCommandInputObject['config'];
  const isConfigText = typeof configField == 'string';

  if (isConfigText == false) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'decode experiments command input',
      message: 'Experiments command config must be a string.',
      cause: rawCommandInputObject,
    });
  }

  const app = readAppSelector(rawCommandInputObject);
  const decodedInput: VersionExperimentsCommandInput = {
    config: configField,
    submit: readBoolean(rawCommandInputObject, 'submit'),
    start: readBoolean(rawCommandInputObject, 'start'),
    dryRun: readBoolean(rawCommandInputObject, 'dryRun'),
    yes: readBoolean(rawCommandInputObject, 'yes'),
  };
  const hasApp = app != null;

  if (hasApp == false) {
    return decodedInput;
  }

  return { ...decodedInput, app };
}

/** Convert a dependency failure into the experiments command channel. */
function experimentsFailure(operation: string, cause: unknown): VersionExperimentsCommandFailure {
  let message = `${operation} failed.`;
  const isText = typeof cause == 'string';

  if (isText) {
    const hasText = cause.length > 0;

    if (hasText) {
      message = cause;
    }
  }

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return makeVersionExperimentsCommandFailure({ operation, message, cause });
}

type ExperimentsTarget = Readonly<{
  bundleId: string;
  experimentsConfig: VersionExperimentsConfig;
  treatmentScreenshots: ReadonlyMap<string, readonly LocalScreenshot[]>;
}>;

/** Resolve the selected bundle id, the required experiments sidecar, and its treatment screenshots. */
async function resolveExperimentsTarget(
  commandInput: VersionExperimentsCommandInput,
): Promise<ExperimentsTarget> {
  let storeAppContext: Awaited<ReturnType<typeof loadStoreAppContext>>;

  try {
    storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw experimentsFailure('select experiments app', cause);
  }

  const bundleId = storeAppContext.app.bundleId;
  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'resolve experiments bundle id',
      message: `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      cause: storeAppContext.app,
    });
  }

  let experimentsConfig: VersionExperimentsConfig | undefined;

  try {
    experimentsConfig = await resolveStoreSurfaceSection(
      undefined,
      commandInput.config,
      true,
      parseVersionExperimentsConfig,
    );
  } catch (cause) {
    throw experimentsFailure('resolve experiments config', cause);
  }

  const loadedExperimentsConfig = experimentsConfig;
  const isConfigMissing = loadedExperimentsConfig == null;

  if (isConfigMissing) {
    throw makeVersionExperimentsCommandFailure({
      operation: 'resolve experiments config',
      message: `No experiments config at ${commandInput.config}. Create one (see \`launch-store experiments --help\`) or pass --config.`,
      cause: commandInput.config,
    });
  }

  let treatmentScreenshots: ReadonlyMap<string, readonly LocalScreenshot[]>;

  try {
    treatmentScreenshots = await discoverTreatmentScreenshots(
      commandInput.config,
      loadedExperimentsConfig,
    );
  } catch (cause) {
    throw experimentsFailure('read treatment screenshots', cause);
  }

  return { bundleId, experimentsConfig: loadedExperimentsConfig, treatmentScreenshots };
}

function isPlannedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'planned';
}

/** Plan, confirm, and apply product-page experiment changes. */
async function executeVersionExperiments(rawCommandInput: unknown): Promise<number> {
  try {
    const commandInput = decodeVersionExperimentsCommandInput(rawCommandInput);
    const experimentsTarget = await resolveExperimentsTarget(commandInput);
    const logger = createLogger(false);
    let appleStore: Awaited<ReturnType<typeof loadActiveAppleStore>>;

    try {
      appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw experimentsFailure('load App Store Connect client', cause);
    }

    const reconciliationInput = {
      bundleId: experimentsTarget.bundleId,
      config: experimentsTarget.experimentsConfig,
      treatmentScreenshots: experimentsTarget.treatmentScreenshots,
      submit: commandInput.submit,
      start: commandInput.start,
    };
    let experimentsPlan: Awaited<ReturnType<typeof reconcileVersionExperiments>>;

    try {
      experimentsPlan = await reconcileVersionExperiments(appleStore, {
        ...reconciliationInput,
        dryRun: true,
      });
    } catch (cause) {
      throw experimentsFailure('plan experiment changes', cause);
    }

    const plannedActions = experimentsPlan.actions.filter(isPlannedAction);
    logger.gap();
    const isAlreadyInSync = experimentsPlan.actions.length == 0;

    if (isAlreadyInSync) {
      logger.step(experimentsTarget.bundleId, 'product-page experiments already in sync');
      return 0;
    }

    const plannedLines = experimentsPlan.actions.map(renderStoreSurfaceAction);
    logger.notice(experimentsTarget.bundleId, ...plannedLines);
    const hasNothingToApply = plannedActions.length == 0;

    if (hasNothingToApply) {
      logger.gap();
      logger.step('experiments', 'nothing to apply (everything already in sync)');
      return 0;
    }

    logger.gap();
    logger.note(`${plannedActions.length} change(s) for ${experimentsTarget.bundleId}.`);

    if (commandInput.dryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return 0;
    }

    let confirmed = false;

    try {
      confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} experiment change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw experimentsFailure('confirm experiment changes', cause);
    }

    const isDeclined = confirmed == false;

    if (isDeclined) {
      return 0;
    }

    let appliedExperiments: Awaited<ReturnType<typeof reconcileVersionExperiments>>;

    try {
      appliedExperiments = await reconcileVersionExperiments(appleStore, {
        ...reconciliationInput,
        dryRun: false,
      });
    } catch (cause) {
      throw experimentsFailure('apply experiment changes', cause);
    }

    const experimentsSummary = summarizeExperiments(appliedExperiments.actions);
    let receiptTitle = 'Applied';
    const hasFailedActions = experimentsSummary.failed > 0;

    if (hasFailedActions) {
      receiptTitle = 'Applied with errors';
    }

    const receiptLines = appliedExperiments.actions.map(renderAppliedStoreSurfaceAction);
    logger.box(receiptTitle, receiptLines);
    return experimentsSummary.failed;
  } catch (cause) {
    throw experimentsFailure('run experiments command', cause);
  }
}

/** Run the decoded experiments command. */
export async function versionExperimentsCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeVersionExperiments(rawCommandInput);
  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}
