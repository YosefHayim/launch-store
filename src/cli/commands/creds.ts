import type { Command } from 'commander';
import { Effect } from 'effect';
import {
  chooseAccountInteractive as chooseAccountInteractiveProgram,
  credentialsCommandProgram,
  setupIos as setupIosProgram,
  type CredentialsCommandOptions,
} from '@core/credentials/command.js';
import { AppStoreIdentityLive } from '@core/services/appStoreIdentity.js';
import { AppleCredentialsClientLive } from '@core/services/appleCredentialsClient.js';
import type { Platform } from '@core/types/app.js';
import { runCliProgram } from '../runCliProgram.js';

export type CredsOptions = CredentialsCommandOptions;

/** Supply credential-specific Apple adapters to a core credentials command. */
const provideCredentialAdapters = (commandInput: Parameters<typeof credentialsCommandProgram>[0]) =>
  credentialsCommandProgram(commandInput).pipe(
    Effect.provide(AppStoreIdentityLive),
    Effect.provide(AppleCredentialsClientLive),
  );

/** Compatibility boundary used by the existing interactive wizard account step. */
export const chooseAccountInteractive = (commandOptions: CredsOptions = {}) =>
  runCliProgram(
    chooseAccountInteractiveProgram(commandOptions).pipe(
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
    ),
  );

/** Compatibility boundary used by the existing interactive wizard signing step. */
export const setupIos = (commandOptions: CredsOptions, platform: Platform = 'ios') =>
  runCliProgram(
    setupIosProgram(commandOptions, platform).pipe(
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
    ),
  );

/** Attach the credentials command and pass raw Commander input to the core schema boundary. */
export const registerCredsCommand = (program: Command): void => {
  program
    .command('creds')
    .description('inspect credentials, onboard/switch Apple accounts, or provision signing assets')
    .argument(
      '[action]',
      'status | set-key | setup | use | rename | remove | refresh | push-key',
      'status',
    )
    .argument('[firstArgument]', 'account selector, Android key path, or push-key action')
    .argument('[secondArgument]', 'new label, APNs import path, or APNs export Key ID')
    .option('--platform <platform>', 'ios (default), android, tvos, macos, or visionos')
    .option('--key-id <id>', 'Apple Key ID')
    .option('--issuer-id <id>', 'App Store Connect Issuer ID')
    .option('--p8 <path>', 'path to an Apple .p8 key')
    .option('--label <name>', 'human-readable account or key label')
    .option('--account <name>', 'Apple account label or Key ID')
    .option('-a, --app <name>', 'configured app handle')
    .option('--import <keystore>', 'existing Android upload keystore')
    .option('--alias <alias>', 'alias inside an imported Android keystore')
    .option('--team-id <id>', 'Apple Team ID for an APNs key')
    .option('--out <path>', 'APNs export destination')
    .option('--force', 'overwrite an existing APNs export destination')
    .option('--yes', 'run without interactive prompts')
    .action(
      (
        action: string,
        firstArgument: string | undefined,
        secondArgument: string | undefined,
        commandOptions: CredsOptions,
      ) =>
        runCliProgram(
          provideCredentialAdapters({
            action,
            firstArgument,
            secondArgument,
            options: commandOptions,
          }),
        ),
    );
};
