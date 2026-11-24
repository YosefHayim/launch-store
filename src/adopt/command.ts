// Copies an existing App Store Connect app into local Launch configuration.

import { join, relative, sep } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { checkTerminalIsInteractive } from '../services/platform/progress.ts';
import { pullAppleListing } from '../store/shared/metadata-command.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { AdoptCatalogApi, Fidelity } from '../types/adopt.ts';
import type { AppDescriptor } from '../types/app.ts';
import { Adoption, type AdoptApplyResult, type TargetPlan } from './adoption.ts';
import { CapabilitiesAdoption } from './capabilities.ts';
import { CertificatesAdoption } from './certificates.ts';
import { ListingAdoption } from './app-store-listing.ts';
import { ProductsAdoption } from './products.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type AdoptCommandInput = {
  all: boolean;
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

function readBooleanFlag(
  record: Record<string, unknown>,
  fieldName: string,
  fallback: boolean,
): boolean {
  if (fieldName in record == false) {
    return fallback;
  }

  const field = record[fieldName];

  if (field == null) {
    return fallback;
  }

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readOptionalString(record: Record<string, unknown>, fieldName: string): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (field == null) {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function decodeAdoptCommandInput(rawCommandInput: unknown): AdoptCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Adopt command input must be an object.');
  }

  const commandInput: AdoptCommandInput = {
    all: readBooleanFlag(rawCommandInputObject, 'all', false),
    dryRun: readBooleanFlag(rawCommandInputObject, 'dryRun', false),
    yes: readBooleanFlag(rawCommandInputObject, 'yes', false),
  };
  const appName = readOptionalString(rawCommandInputObject, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const AdoptCommandInputSchema = decodeAdoptCommandInput;

function trimAppName(appName: string): string {
  return appName.trim();
}

function isNamedApp(appName: string): boolean {
  return appName.length > 0;
}

/** Select every discovered app or the comma-separated handles passed through --app. */
export function selectAdoptApps(
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): AppDescriptor[] {
  if (appSelector == null) {
    return [...discoveredApps];
  }

  const requestedNames = appSelector.split(',').map(trimAppName).filter(isNamedApp);
  const appsByName = new Map(
    discoveredApps.map(function appByName(discoveredApp: AppDescriptor) {
      return [discoveredApp.name, discoveredApp] as const;
    }),
  );
  const selectedApps: AppDescriptor[] = [];

  for (const requestedName of requestedNames) {
    const selectedApp = appsByName.get(requestedName);

    if (selectedApp != null) {
      selectedApps.push(selectedApp);
      continue;
    }

    let discoveredNames = 'none';

    if (discoveredApps.length > 0) {
      discoveredNames = discoveredApps
        .map(function appNameOf(discoveredApp: AppDescriptor) {
          return discoveredApp.name;
        })
        .join(', ');
    }

    throw new Error(`Unknown app "${requestedName}". Discovered apps: ${discoveredNames}.`);
  }

  return selectedApps;
}

function countConfigWrites(targetPlan: TargetPlan): number {
  return targetPlan.writes.filter(function isConfigWrite(plannedWrite) {
    return plannedWrite.change.home != 'keychain';
  }).length;
}

/** Count planned writes that modify local configuration (keychain reports are detect-only). */
export function countAdoptMutations(targetPlans: readonly TargetPlan[]): number {
  return targetPlans.reduce(function addMutations(mutationTotal, targetPlan) {
    return mutationTotal + countConfigWrites(targetPlan);
  }, 0);
}

/** ASCII marker for one planned write's fidelity tier. */
export function adoptFidelityMarker(fidelity: Fidelity): string {
  switch (fidelity) {
    case 'importable':
      return '+';
    case 'advisory':
      return '~';
    case 'detect':
      return '-';
  }
}

/** Minimal path ops used to detect a shared monorepo app root. */
type SharedAppRootPath = Readonly<{
  relative: (from: string, to: string) => string;
  sep: string;
}>;

/** Shared monorepo app-root segment for a generated Launch configuration, if unique. */
export function detectSharedAppRoot(
  selectedApps: readonly AppDescriptor[],
  workingDirectory: string,
  pathService: SharedAppRootPath,
): string | null {
  const rootSegments = new Set<string>();

  for (const selectedApp of selectedApps) {
    const relativeAppPath = pathService.relative(workingDirectory, selectedApp.dir);

    if (relativeAppPath == '') {
      return null;
    }

    const firstSegment = relativeAppPath.split(pathService.sep)[0];

    if (firstSegment == null) {
      continue;
    }

    if (firstSegment.length == 0) {
      continue;
    }

    rootSegments.add(firstSegment);
  }

  if (rootSegments.size != 1) {
    return null;
  }

  const sharedSegment = [...rootSegments][0];

  if (sharedSegment == null) {
    return null;
  }

  return `.${pathService.sep}${sharedSegment}`;
}

/** Print one app's adopt plan. */
function printTargetPlan(logger: Logger, targetPlan: TargetPlan): void {
  const planLines: string[] = [];

  for (const plannedWrite of targetPlan.writes) {
    const fidelityMarker = adoptFidelityMarker(plannedWrite.fidelity);

    planLines.push(`${fidelityMarker} ${plannedWrite.description}`);

    if (plannedWrite.note != null) {
      planLines.push(`    -> ${plannedWrite.note}`);
    }
  }

  for (const adopterFailure of targetPlan.errors) {
    planLines.push(`x ${adopterFailure.domain}: ${adopterFailure.message}`);
  }

  const hasNoLines = planLines.length == 0;

  if (hasNoLines) {
    planLines.push('nothing to adopt');
  }

  logger.notice(
    `${targetPlan.detected.target.app.name} (${targetPlan.detected.target.bundleId}) - ${targetPlan.detected.signal}`,
    ...planLines,
  );
}

/** Print the files and listing state changed by adoption. */
function printAdoptReceipt(
  logger: Logger,
  workingDirectory: string,
  adoptionSummary: AdoptApplyResult,
): void {
  const receiptLines: string[] = [];

  if (adoptionSummary.configWritten != null) {
    receiptLines.push(
      `OK wrote ${relative(workingDirectory, adoptionSummary.configWritten)} (review the imported products)`,
    );
  }

  for (const patchedApp of adoptionSummary.appJsonPatched) {
    receiptLines.push(
      `OK ${patchedApp.app}: added ${patchedApp.added.length} entitlement(s) to ${relative(workingDirectory, patchedApp.configPath)}`,
    );
  }

  for (const pulledListing of adoptionSummary.listingsPulled) {
    receiptLines.push(
      `OK ${pulledListing}: printed the App Store listing. Add it under listing in launch.config.ts.`,
    );
  }

  for (const failedListing of adoptionSummary.listingErrors) {
    receiptLines.push(`x ${failedListing.app}: listing pull failed - ${failedListing.message}`);
  }

  const hasReceipt = receiptLines.length > 0;

  if (hasReceipt) {
    let receiptTitle = 'Adopted';

    if (adoptionSummary.listingErrors.length > 0) {
      receiptTitle = 'Adopted with errors';
    }

    logger.box(receiptTitle, receiptLines);
  }

  if (adoptionSummary.configBlock != null) {
    logger.notice(
      'launch.config.ts already exists - add this `products` block, then run `launch-store sync`:',
      adoptionSummary.configBlock,
    );
  }

  for (const dynamicConfigBlock of adoptionSummary.appJsonBlocks) {
    logger.notice(
      `${dynamicConfigBlock.app}: ${relative(workingDirectory, dynamicConfigBlock.configPath)} is dynamic - paste this into your config:`,
      dynamicConfigBlock.block,
    );
  }
}

function skippedLine(skippedApp: { app: { name: string }; reason: string }): string {
  return `- ${skippedApp.app.name}: ${skippedApp.reason}`;
}

/** Run the decoded adopt command through shared services. */
export async function adoptCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeAdoptCommandInput(rawCommandInput);
    const launchPaths = readLaunchDirectories();
    const logger = createLogger(false);
    const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
    const selectedApps = selectAdoptApps(loadedConfiguration.apps, commandInput.app);

    const hasNoApps = selectedApps.length == 0;

    if (hasNoApps) {
      logger.note('No apps discovered. Run `launch-store init` or check your appRoots first.');
      return;
    }

    const ascKey = await loadActiveAscKey();

    if (ascKey == null) {
      throw new Error('No active Apple account. Run `launch-store creds set-key` first.');
    }

    const appleCatalog: AdoptCatalogApi = new AppleStoreClientService().createClient(ascKey);
    const launchConfigPath = join(launchPaths.workingDirectory, 'launch.config.ts');
    const hasLaunchConfig = await pathExists(launchConfigPath);

    const adoption = new Adoption(appleCatalog, [
      new ProductsAdoption(),
      new CapabilitiesAdoption(),
      new CertificatesAdoption(),
      new ListingAdoption(),
    ]);
    const detection = await adoption.detect(selectedApps, {
      keyId: ascKey.keyId,
      cwd: launchPaths.workingDirectory,
      hasLaunchConfig,
    });

    const hasSkippedApps = detection.skipped.length > 0;

    if (hasSkippedApps) {
      logger.notice('Skipped', ...detection.skipped.map(skippedLine));
    }

    const hasNoDetectedApps = detection.detected.length == 0;

    if (hasNoDetectedApps) {
      logger.note(
        'No adoptable apps - none of the discovered apps have an App Store Connect record yet.',
      );
      return;
    }

    const targetPlans = await adoption.plan(detection);

    logger.gap();

    for (const targetPlan of targetPlans) {
      printTargetPlan(logger, targetPlan);
    }

    const mutationCount = countAdoptMutations(targetPlans);

    logger.gap();

    const hasNoMutations = mutationCount == 0;

    if (hasNoMutations) {
      logger.note('Nothing to import - the detect-only findings need no config changes.');
      return;
    }

    logger.note(`${mutationCount} import(s) across ${targetPlans.length} app(s).`);

    if (commandInput.dryRun) {
      logger.note('Dry run - nothing imported. Re-run without --dry-run to apply.');
      return;
    }

    if (commandInput.yes == false) {
      const isInteractive = checkTerminalIsInteractive();

      if (isInteractive == false) {
        throw new Error('Refusing to import without confirmation. Re-run with --yes or --dry-run.');
      }

      const confirmed = await new LaunchPrompt().confirm(
        `Import ${mutationCount} change(s) into your local config?`,
      );

      if (confirmed == false) {
        new LaunchPrompt().cancel('Aborted - nothing imported.');
        return;
      }
    }

    const sharedAppRoot = detectSharedAppRoot(selectedApps, launchPaths.workingDirectory, {
      relative,
      sep,
    });
    const adoptionSummary = await adoption.apply(targetPlans, {
      cwd: launchPaths.workingDirectory,
      hasLaunchConfig,
      appRoot: sharedAppRoot,
      pullListing(bundleId) {
        return pullAppleListing(bundleId, false);
      },
    });

    logger.gap();
    printAdoptReceipt(logger, launchPaths.workingDirectory, adoptionSummary);

    const hasListingErrors = adoptionSummary.listingErrors.length > 0;

    if (hasListingErrors) {
      completeCommand(1);
    }
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}
