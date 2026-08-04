import { type FileSystem, Path, type Terminal } from '@effect/platform';
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
import { parseWalletConfig, reconcileWalletIds } from './walletIds.js';

export const WalletCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('reconcile'),
    configPath: Schema.String,
    explicitConfig: Schema.Boolean,
    dryRun: Schema.Boolean,
    yes: Schema.Boolean,
  }),
  Schema.Struct({ operation: Schema.Literal('list') }),
);

export type WalletCommandInput = Schema.Schema.Type<typeof WalletCommandInputSchema>;

export type WalletCommandFailure = Readonly<{
  readonly _tag: 'WalletCommandFailure';
  readonly operation: WalletCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeWalletCommandFailure = Data.tagged<WalletCommandFailure>('WalletCommandFailure');

type WalletCommandRequirements =
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

const reconcileWallet = (
  commandInput: Extract<WalletCommandInput, { operation: 'reconcile' }>,
): Effect.Effect<void, CommandExit | unknown, WalletCommandRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const configPath = yield* projectPath(commandInput.configPath);
    const walletConfiguration = yield* resolveStoreSurfaceSection(
      loadedConfiguration.config.wallet,
      configPath,
      commandInput.explicitConfig,
      parseWalletConfig,
    );
    if (walletConfiguration === undefined) {
      return yield* Effect.fail(
        makeWalletCommandFailure({
          operation: 'reconcile',
          message: `No wallet config. Add a \`wallet\` field to launch.config.ts or create ${commandInput.configPath}.`,
        }),
      );
    }
    const appleStore = yield* loadActiveAppleStore();
    const plannedActions = yield* reconcileWalletIds(appleStore, walletConfiguration, true);
    yield* logger.gap();
    if (plannedActions.length === 0) {
      yield* logger.step('wallet', 'merchant ids and pass type ids already registered');
      return;
    }
    yield* logger.notice(
      'Apple Pay / Wallet identifiers',
      ...plannedActions.map(renderStoreSurfaceAction),
    );
    yield* logger.gap();
    yield* logger.note(`${plannedActions.length} identifier(s) to register.`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return;
    }
    if (
      !(yield* confirmStoreSurfaceWrite(
        `Register ${plannedActions.length} identifier(s)?`,
        commandInput.yes,
      ))
    ) {
      return;
    }
    const appliedActions = yield* reconcileWalletIds(appleStore, walletConfiguration, false);
    const failedActionCount = appliedActions.filter(
      (appliedAction) => appliedAction.status === 'failed',
    ).length;
    let receiptTitle = 'Identifiers registered';
    if (failedActionCount > 0) receiptTitle = 'Registered with errors';
    yield* logger.box(receiptTitle, appliedActions.map(renderAppliedStoreSurfaceAction));
    if (failedActionCount > 0) yield* completeCommand(1);
  });

const identifierLines = (
  familyTitle: string,
  identifiers: readonly Readonly<{ identifier?: string; name?: string }>[],
): Readonly<{ title: string; lines: string[] }> => {
  const lines: string[] = [];
  for (const registeredIdentifier of identifiers) {
    let identifier = '?';
    if (registeredIdentifier.identifier !== undefined) identifier = registeredIdentifier.identifier;
    let nameText = '';
    if (registeredIdentifier.name !== undefined) nameText = ` (${registeredIdentifier.name})`;
    lines.push(`- ${identifier}${nameText}`);
  }
  if (lines.length === 0) lines.push('- none registered');
  return { title: familyTitle, lines };
};

const listWalletIdentifiers = (): Effect.Effect<void, unknown, WalletCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const appleStore = yield* loadActiveAppleStore();
    const walletState = yield* Effect.all(
      {
        merchantIds: appleStore.listMerchantIds(),
        passTypeIds: appleStore.listPassTypeIds(),
      },
      { concurrency: 'unbounded' },
    );
    const merchantSection = identifierLines('Apple Pay merchant ids', walletState.merchantIds);
    const passSection = identifierLines('Wallet pass type ids', walletState.passTypeIds);
    yield* logger.notice(merchantSection.title, ...merchantSection.lines);
    yield* logger.notice(passSection.title, ...passSection.lines);
  });

export const walletCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | WalletCommandFailure, WalletCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(WalletCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'reconcile':
        return yield* reconcileWallet(commandInput);
      case 'list':
        return yield* listWalletIdentifiers();
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      let operation: WalletCommandInput['operation'] = 'reconcile';
      if (Schema.is(WalletCommandInputSchema)(rawCommandInput)) {
        operation = rawCommandInput.operation;
      }
      return makeWalletCommandFailure({
        operation,
        message: errorMessage(cause),
        cause,
      });
    }),
  );
