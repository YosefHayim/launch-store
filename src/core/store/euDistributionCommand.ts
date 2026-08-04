import { FileSystem, Path, type Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import {
  confirmStoreSurfaceWrite,
  renderAppliedStoreSurfaceAction,
  renderStoreSurfaceAction,
  resolveStoreSurfaceSection,
} from './appStoreSurfaceCommand.js';
import { parseEuDistributionConfig, reconcileEuDistributionDomains } from './euDistribution.js';

export const EuDistributionCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('reconcile'),
    configPath: Schema.String,
    explicitConfig: Schema.Boolean,
    dryRun: Schema.Boolean,
    yes: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literal('set-key'), pemPath: Schema.String }),
  Schema.Struct({ operation: Schema.Literal('list') }),
);

export type EuDistributionCommandInput = Schema.Schema.Type<
  typeof EuDistributionCommandInputSchema
>;

export type EuDistributionCommandFailure = Readonly<{
  readonly _tag: 'EuDistributionCommandFailure';
  readonly operation: EuDistributionCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeEuDistributionCommandFailure = Data.tagged<EuDistributionCommandFailure>(
  'EuDistributionCommandFailure',
);

type EuDistributionCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal;

const projectPath = (
  commandPath: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    if (pathService.isAbsolute(commandPath)) return commandPath;
    return pathService.join(launchPaths.workingDirectory, commandPath);
  });

const reconcileDomains = (
  commandInput: Extract<EuDistributionCommandInput, { operation: 'reconcile' }>,
): Effect.Effect<void, CommandExit | unknown, EuDistributionCommandRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const configPath = yield* projectPath(commandInput.configPath);
    const euDistributionConfiguration = yield* resolveStoreSurfaceSection(
      loadedConfiguration.config.euDistribution,
      configPath,
      commandInput.explicitConfig,
      parseEuDistributionConfig,
    );
    if (euDistributionConfiguration === undefined) {
      return yield* Effect.fail(
        makeEuDistributionCommandFailure({
          operation: 'reconcile',
          message: `No EU distribution config. Add an \`euDistribution\` field to launch.config.ts or create ${commandInput.configPath}.`,
        }),
      );
    }
    const appleStore = yield* loadActiveAppleStore();
    const plannedActions = yield* reconcileEuDistributionDomains(
      appleStore,
      euDistributionConfiguration,
      true,
    );
    yield* logger.gap();
    if (plannedActions.length === 0) {
      yield* logger.step('eu-distribution', 'distribution domains already authorized');
      return;
    }
    yield* logger.notice(
      'EU alternative distribution',
      ...plannedActions.map(renderStoreSurfaceAction),
    );
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} domain(s) to authorize.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return;
    }
    if (
      !(yield* confirmStoreSurfaceWrite(
        `Authorize ${plannedActions.length} distribution domain(s)?`,
        commandInput.yes,
      ))
    ) {
      return;
    }
    const appliedActions = yield* reconcileEuDistributionDomains(
      appleStore,
      euDistributionConfiguration,
      false,
    );
    const failedActionCount = appliedActions.filter(
      (appliedAction) => appliedAction.status === 'failed',
    ).length;
    let receiptTitle = 'Domains authorized';
    if (failedActionCount > 0) receiptTitle = 'Authorized with errors';
    yield* logger.box(receiptTitle, appliedActions.map(renderAppliedStoreSurfaceAction));
    if (failedActionCount > 0) yield* completeCommand(1);
  });

const setDistributionKey = (
  pemPath: string,
): Effect.Effect<void, unknown, EuDistributionCommandRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const logger = yield* createLogger(false);
    const publicKeyPath = yield* projectPath(pemPath);
    const publicKey = (yield* fileSystem.readFileString(publicKeyPath)).trim();
    if (publicKey.length === 0) {
      return yield* Effect.fail(
        makeEuDistributionCommandFailure({
          operation: 'set-key',
          message: `${pemPath} is empty - expected a PEM public key.`,
        }),
      );
    }
    const appleStore = yield* loadActiveAppleStore();
    const registeredKeys = yield* appleStore.listAlternativeDistributionKeys();
    const registeredKey = registeredKeys[0];
    if (registeredKey !== undefined) {
      yield* logger.note(
        `A distribution key is already registered (id ${registeredKey.id}). Delete it in App Store Connect to replace it.`,
      );
      return;
    }
    yield* appleStore.createAlternativeDistributionKey(publicKey);
    yield* logger.ok('Registered the alternative-distribution public key.');
  });

const listDistributionState = (): Effect.Effect<void, unknown, EuDistributionCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore();
    const distributionState = yield* Effect.all(
      {
        domains: appleStore.listAlternativeDistributionDomains(),
        keys: appleStore.listAlternativeDistributionKeys(),
      },
      { concurrency: 'unbounded' },
    );
    let keyStatus = 'not registered';
    if (distributionState.keys.length > 0) keyStatus = 'registered';
    const domainLines: string[] = [];
    for (const distributionDomain of distributionState.domains) {
      let domainName = '?';
      if (distributionDomain.domain !== undefined) domainName = distributionDomain.domain;
      let referenceText = '';
      if (distributionDomain.referenceName !== undefined) {
        referenceText = ` (${distributionDomain.referenceName})`;
      }
      domainLines.push(`- ${domainName}${referenceText}`);
    }
    if (domainLines.length === 0) domainLines.push('- no domains authorized');
    yield* logger.notice(`EU alternative distribution - key ${keyStatus}`, ...domainLines);
  });

export const euDistributionCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<
  void,
  CommandExit | EuDistributionCommandFailure,
  EuDistributionCommandRequirements
> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(EuDistributionCommandInputSchema)(
      rawCommandInput,
    );
    switch (commandInput.operation) {
      case 'reconcile':
        return yield* reconcileDomains(commandInput);
      case 'set-key':
        return yield* setDistributionKey(commandInput.pemPath);
      case 'list':
        return yield* listDistributionState();
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      let operation: EuDistributionCommandInput['operation'] = 'reconcile';
      if (Schema.is(EuDistributionCommandInputSchema)(rawCommandInput)) {
        operation = rawCommandInput.operation;
      }
      return makeEuDistributionCommandFailure({
        operation,
        message: errorMessage(cause),
        cause,
      });
    }),
  );
