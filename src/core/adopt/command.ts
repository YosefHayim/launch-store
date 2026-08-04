import { FileSystem, Path, Terminal } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { errorMessage } from '../services/errorMessage.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
} from '../services/appleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { pullAppleListing } from '../store/metadataCommand.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AdoptCatalogApi, Fidelity } from '../types/adopt.js';
import type { AppDescriptor } from '../types/app.js';
import {
  applyAdopt,
  detectTargets,
  planTargets,
  type AdoptApplyResult,
  type TargetPlan,
} from './orchestrator.js';
import { listAdopters, registerBuiltinAdopters } from './registry.js';

export const AdoptCommandInputSchema = Schema.Struct({
  all: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  yes: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type AdoptCommandInput = Schema.Schema.Type<typeof AdoptCommandInputSchema>;

/** The adopt command could not read or apply existing App Store state. */
export type AdoptCommandFailure = Readonly<{
  readonly _tag: 'AdoptCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAdoptCommandFailure = Data.tagged<AdoptCommandFailure>('AdoptCommandFailure');

export const AdoptCommandFailureSchema: Schema.Schema<AdoptCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('AdoptCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type AdoptCommandRequirements =
  | AppleStoreClientRequirements
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Normalize one adopt failure into the command error channel. */
const adoptFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AdoptCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeAdoptCommandFailure({ operation, message, cause });
};

/** Select every discovered app or the comma-separated handles passed through --app. */
export const selectAdoptApps = (
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<AppDescriptor[], AdoptCommandFailure> => {
  if (appSelector === undefined) return Effect.succeed([...discoveredApps]);
  const requestedNames = appSelector
    .split(',')
    .map((appName) => appName.trim())
    .filter((appName) => appName.length > 0);
  const appsByName = new Map(
    discoveredApps.map((discoveredApp) => [discoveredApp.name, discoveredApp]),
  );
  const selectedApps: AppDescriptor[] = [];
  for (const requestedName of requestedNames) {
    const selectedApp = appsByName.get(requestedName);
    if (selectedApp !== undefined) {
      selectedApps.push(selectedApp);
      continue;
    }
    let discoveredNames = 'none';
    if (discoveredApps.length > 0)
      discoveredNames = discoveredApps.map((discoveredApp) => discoveredApp.name).join(', ');
    return Effect.fail(
      adoptFailure(
        'select apps to adopt',
        requestedName,
        `Unknown app "${requestedName}". Discovered apps: ${discoveredNames}.`,
      ),
    );
  }
  return Effect.succeed(selectedApps);
};

/** Count planned writes that modify local configuration. */
const countMutations = (targetPlans: readonly TargetPlan[]): number =>
  targetPlans.reduce(
    (mutationTotal, targetPlan) =>
      mutationTotal +
      targetPlan.writes.filter((plannedWrite) => plannedWrite.change.home !== 'keychain').length,
    0,
  );

/** Render the ASCII marker for one planned write. */
const fidelityMarker = (fidelity: Fidelity): string => {
  switch (fidelity) {
    case 'importable':
      return '+';
    case 'advisory':
      return '~';
    case 'detect':
      return '-';
  }
};

/** Print one app's adopt plan. */
const printTargetPlan = (logger: Logger, targetPlan: TargetPlan): Effect.Effect<void, unknown> => {
  const planLines: string[] = [];
  for (const plannedWrite of targetPlan.writes) {
    planLines.push(`${fidelityMarker(plannedWrite.fidelity)} ${plannedWrite.description}`);
    if (plannedWrite.note !== undefined) planLines.push(`    -> ${plannedWrite.note}`);
  }
  for (const adopterFailure of targetPlan.errors)
    planLines.push(`x ${adopterFailure.domain}: ${adopterFailure.message}`);
  if (planLines.length === 0) planLines.push('nothing to adopt');
  return logger.notice(
    `${targetPlan.detected.target.app.name} (${targetPlan.detected.target.bundleId}) - ${targetPlan.detected.signal}`,
    ...planLines,
  );
};

/** Find the shared app-root folder for a generated Launch configuration. */
const detectSharedAppRoot = (
  selectedApps: readonly AppDescriptor[],
  workingDirectory: string,
  pathService: Path.Path,
): string | null => {
  const rootSegments = new Set<string>();
  for (const selectedApp of selectedApps) {
    const relativeAppPath = pathService.relative(workingDirectory, selectedApp.dir);
    if (relativeAppPath === '') return null;
    const firstSegment = relativeAppPath.split(pathService.sep)[0];
    if (firstSegment !== undefined && firstSegment.length > 0) rootSegments.add(firstSegment);
  }
  if (rootSegments.size !== 1) return null;
  const sharedSegment = [...rootSegments][0];
  if (sharedSegment === undefined) return null;
  return `.${pathService.sep}${sharedSegment}`;
};

/** Print the files and listing state changed by adoption. */
const printAdoptReceipt = (
  logger: Logger,
  workingDirectory: string,
  adoptionSummary: AdoptApplyResult,
): Effect.Effect<void, unknown, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const receiptLines: string[] = [];
    if (adoptionSummary.configWritten !== undefined) {
      receiptLines.push(
        `OK wrote ${pathService.relative(workingDirectory, adoptionSummary.configWritten)} (review the imported products)`,
      );
    }
    for (const patchedApp of adoptionSummary.appJsonPatched) {
      receiptLines.push(
        `OK ${patchedApp.app}: added ${patchedApp.added.length} entitlement(s) to ${pathService.relative(workingDirectory, patchedApp.configPath)}`,
      );
    }
    for (const pulledListing of adoptionSummary.listingsPulled)
      receiptLines.push(`OK ${pulledListing}: pulled App Store listing -> store.config.json`);
    for (const failedListing of adoptionSummary.listingErrors)
      receiptLines.push(`x ${failedListing.app}: listing pull failed - ${failedListing.message}`);
    if (receiptLines.length > 0) {
      let receiptTitle = 'Adopted';
      if (adoptionSummary.listingErrors.length > 0) receiptTitle = 'Adopted with errors';
      yield* logger.box(receiptTitle, receiptLines);
    }
    if (adoptionSummary.configBlock !== undefined) {
      yield* logger.notice(
        'launch.config.ts already exists - add this `products` block, then run `launch sync`:',
        adoptionSummary.configBlock,
      );
    }
    for (const dynamicConfigBlock of adoptionSummary.appJsonBlocks) {
      yield* logger.notice(
        `${dynamicConfigBlock.app}: ${pathService.relative(workingDirectory, dynamicConfigBlock.configPath)} is dynamic - paste this into your config:`,
        dynamicConfigBlock.block,
      );
    }
  });

/** Run the schema-decoded adopt command through shared services. */
export const adoptCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, AdoptCommandFailure | CommandExit, AdoptCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(AdoptCommandInputSchema)(rawCommandInput);
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const selectedApps = yield* selectAdoptApps(loadedConfiguration.apps, commandInput.app);
    if (selectedApps.length === 0) {
      yield* logger.note('No apps discovered. Run `launch init` or check your appRoots first.');
      return;
    }
    const ascKey = yield* loadActiveAscKey();
    if (ascKey === null) {
      return yield* Effect.fail(
        adoptFailure(
          'load active Apple account',
          'missing-active-account',
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    const appleCatalog: AdoptCatalogApi = yield* appleStoreClients.createEffectClient(ascKey);
    const launchConfigPath = pathService.join(launchPaths.workingDirectory, 'launch.config.ts');
    const hasLaunchConfig = yield* fileSystem.exists(launchConfigPath);
    yield* Effect.sync(registerBuiltinAdopters);
    const detection = yield* detectTargets(appleCatalog, selectedApps, {
      keyId: ascKey.keyId,
      cwd: launchPaths.workingDirectory,
      hasLaunchConfig,
    });
    if (detection.skipped.length > 0) {
      yield* logger.notice(
        'Skipped',
        ...detection.skipped.map((skippedApp) => `- ${skippedApp.app.name}: ${skippedApp.reason}`),
      );
    }
    if (detection.detected.length === 0) {
      yield* logger.note(
        'No adoptable apps - none of the discovered apps have an App Store Connect record yet.',
      );
      return;
    }
    const targetPlans = yield* planTargets(appleCatalog, detection, listAdopters());
    yield* logger.gap();
    for (const targetPlan of targetPlans) yield* printTargetPlan(logger, targetPlan);
    const mutationCount = countMutations(targetPlans);
    yield* logger.gap();
    if (mutationCount === 0) {
      yield* logger.note('Nothing to import - the detect-only findings need no config changes.');
      return;
    }
    yield* logger.note(`${mutationCount} import(s) across ${targetPlans.length} app(s).`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - nothing imported. Re-run without --dry-run to apply.');
      return;
    }
    if (!commandInput.yes) {
      const terminal = yield* Terminal.Terminal;
      if (!(yield* terminal.isTTY)) {
        return yield* Effect.fail(
          adoptFailure(
            'confirm adoption',
            'confirmation-required',
            'Refusing to import without confirmation. Re-run with --yes or --dry-run.',
          ),
        );
      }
      const launchPrompt = yield* LaunchPrompt;
      const confirmed = yield* launchPrompt.confirm(
        `Import ${mutationCount} change(s) into your local config?`,
      );
      if (!confirmed) {
        yield* launchPrompt.cancel('Aborted - nothing imported.');
        return;
      }
    }
    const adoptionSummary = yield* applyAdopt(targetPlans, {
      cwd: launchPaths.workingDirectory,
      hasLaunchConfig,
      appRoot: detectSharedAppRoot(selectedApps, launchPaths.workingDirectory, pathService),
      pullListing: (bundleId, configPath) => pullAppleListing(bundleId, configPath, false),
    });
    yield* logger.gap();
    yield* printAdoptReceipt(logger, launchPaths.workingDirectory, adoptionSummary);
    if (adoptionSummary.listingErrors.length > 0) yield* completeCommand(1);
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      if (Schema.is(AdoptCommandFailureSchema)(cause)) return cause;
      return adoptFailure('adopt existing app', cause);
    }),
  );
