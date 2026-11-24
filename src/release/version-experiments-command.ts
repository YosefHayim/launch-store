// Plans and applies App Store product-page experiments, including their screenshots.

import { join } from 'node:path';
import type { LocalScreenshot } from '../listing/screenshots/assets.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
} from '../apple/app-store-surface-command.ts';
import { loadActiveAppleStore } from '../apple/apple-store-command.ts';
import { loadConfig, type LoadedConfig } from '../config/config.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  discoverTreatmentScreenshots,
  reconcileVersionExperiments,
  summarizeExperiments,
  type VersionExperimentsConfig,
} from './version-experiments.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type VersionExperimentsCommandInput = {
  readonly app?: string;
  readonly submit: boolean;
  readonly start: boolean;
  readonly dryRun: boolean;
  readonly yes: boolean;
};

function readBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];
  const isBoolean = typeof field == 'boolean';

  if (isBoolean == false) {
    throw new Error(`Experiments command ${fieldName} must be a boolean.`, { cause: record });
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
    throw new Error('Experiments command app must be a string when it is present.', {
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
    throw new Error('Experiments command input must be an object.', { cause: rawCommandInput });
  }

  const app = readAppSelector(rawCommandInputObject);
  const decodedInput: VersionExperimentsCommandInput = {
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

type ExperimentsTarget = Readonly<{
  bundleId: string;
  experimentsConfig: VersionExperimentsConfig;
  treatmentScreenshots: ReadonlyMap<string, readonly LocalScreenshot[]>;
}>;

type ScreenshotFileHome = Readonly<{
  appLaunch: LoadedConfig['config'];
  fallbackLaunch: LoadedConfig['config'];
  appDirectory: string;
  loadedDirectory: string | null;
}>;

function pickScreenshotDirectory(home: ScreenshotFileHome): string {
  const cameFromAppFile = Object.is(home.appLaunch, home.fallbackLaunch) == false;

  if (cameFromAppFile) {
    return home.appDirectory;
  }

  const loadedDirectory = home.loadedDirectory;

  const isLoadedDirectoryMissing = loadedDirectory == null;

  if (isLoadedDirectoryMissing) {
    return home.appDirectory;
  }

  return loadedDirectory;
}

/** Read the selected bundle, its experiments, and treatment screenshots. */
async function readExperimentsTarget(
  commandInput: VersionExperimentsCommandInput,
): Promise<ExperimentsTarget> {
  try {
    var storeAppContext = await loadStoreAppContext(commandInput.app);
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const bundleId = storeAppContext.app.bundleId;

  const isBundleMissing = bundleId == null;

  if (isBundleMissing) {
    throw new Error(
      `No iOS bundle identifier for ${storeAppContext.app.name} (set ios.bundleIdentifier in app.json).`,
      { cause: storeAppContext.app },
    );
  }

  const experimentsForBundle = storeAppContext.config.experiments?.[bundleId];

  const isExperimentsMissing = experimentsForBundle == null;

  if (isExperimentsMissing) {
    throw new Error(
      `No experiments for ${bundleId}. Add an experiments entry to launch.config.ts.`,
      { cause: bundleId },
    );
  }

  try {
    var loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  const screenshotDirectory = pickScreenshotDirectory({
    appLaunch: storeAppContext.config,
    fallbackLaunch: loadedConfiguration.config,
    appDirectory: storeAppContext.app.dir,
    loadedDirectory: loadedConfiguration.directory,
  });
  const experimentsFilePath = join(screenshotDirectory, 'launch.config.ts');
  try {
    var treatmentScreenshots = await discoverTreatmentScreenshots(
      experimentsFilePath,
      experimentsForBundle,
    );
  } catch (cause) {
    throw new Error(errorMessage(cause), { cause: cause });
  }

  return { bundleId, experimentsConfig: experimentsForBundle, treatmentScreenshots };
}

function isPlannedAction(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'planned';
}

/** Plan, confirm, and apply product-page experiment changes. */
async function executeVersionExperiments(rawCommandInput: unknown): Promise<number> {
  try {
    const commandInput = decodeVersionExperimentsCommandInput(rawCommandInput);
    const experimentsTarget = await readExperimentsTarget(commandInput);
    const logger = createLogger(false);
    try {
      var appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const reconciliationInput = {
      bundleId: experimentsTarget.bundleId,
      config: experimentsTarget.experimentsConfig,
      treatmentScreenshots: experimentsTarget.treatmentScreenshots,
      submit: commandInput.submit,
      start: commandInput.start,
    };
    try {
      var experimentsPlan = await reconcileVersionExperiments(appleStore, {
        ...reconciliationInput,
        dryRun: true,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
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

    try {
      var confirmed = await confirmStoreSurfaceWrite(
        `Apply ${plannedActions.length} experiment change(s) to App Store Connect?`,
        commandInput.yes,
      );
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
    }

    const isDeclined = confirmed == false;

    if (isDeclined) {
      return 0;
    }

    try {
      var appliedExperiments = await reconcileVersionExperiments(appleStore, {
        ...reconciliationInput,
        dryRun: false,
      });
    } catch (cause) {
      throw new Error(errorMessage(cause), { cause: cause });
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
    throw new Error(errorMessage(cause), { cause: cause });
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
