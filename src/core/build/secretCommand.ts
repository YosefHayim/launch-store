import type { FileSystem, Path } from '@effect/platform';
import { Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { selectStoreApp, type StoreAppSelectionRequirements } from '../store/selectStoreApp.js';
import {
  listSecretRefs,
  removeBuildSecret,
  setBuildSecret,
  type SecretRef,
} from './buildSecrets.js';

const SecretOptionsSchema = {
  app: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
};

export const SecretCommandInputSchema = Schema.Union(
  Schema.Struct({
    action: Schema.Literal('list', 'status'),
    ...SecretOptionsSchema,
  }),
  Schema.Struct({
    action: Schema.Literal('set'),
    name: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    yes: Schema.Boolean,
    ...SecretOptionsSchema,
  }),
  Schema.Struct({
    action: Schema.Literal('rm', 'remove'),
    name: Schema.optional(Schema.String),
    ...SecretOptionsSchema,
  }),
);

export type SecretCommandInput = Schema.Schema.Type<typeof SecretCommandInputSchema>;

export type SecretCommandFailure = Readonly<{
  readonly _tag: 'SecretCommandFailure';
  readonly action: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeSecretCommandFailure = Data.tagged<SecretCommandFailure>('SecretCommandFailure');

type SecretCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Render a secret reference's app-wide or profile-specific scope. */
const scopeLabel = (secretReference: SecretRef): string => {
  if (secretReference.profile === null) return 'all profiles';
  return `profile ${secretReference.profile}`;
};

/** Build one secret coordinate from the selected app and optional profile. */
const makeSecretReference = (
  appName: string,
  profileName: string | undefined,
  environmentName: string,
): SecretRef => {
  let profile: string | null = null;
  if (profileName !== undefined) profile = profileName;
  return { app: appName, profile, name: environmentName };
};

/** Store or overwrite one keychain-backed build secret. */
const setSecretValue = (
  commandInput: Extract<SecretCommandInput, { action: 'set' }>,
): Effect.Effect<void, unknown, SecretCommandRequirements> =>
  Effect.gen(function* () {
    if (commandInput.name === undefined) {
      return yield* Effect.fail(
        makeSecretCommandFailure({
          action: 'set',
          message:
            'Usage: launch secret set <NAME> [--value <v>] [--app <app>] [--profile <profile>].',
        }),
      );
    }
    if (!ENVIRONMENT_NAME.test(commandInput.name)) {
      return yield* Effect.fail(
        makeSecretCommandFailure({
          action: 'set',
          message: `"${commandInput.name}" is not a valid env var name (letters, digits, underscores).`,
        }),
      );
    }
    const selectedApp = yield* selectStoreApp(commandInput.app);
    let secretValue = commandInput.value;
    if (secretValue === undefined) {
      const terminal = yield* Terminal.Terminal;
      const terminalIsInteractive = yield* terminal.isTTY;
      if (commandInput.yes) {
        return yield* Effect.fail(
          makeSecretCommandFailure({
            action: 'set',
            message:
              'A value is required. Pass --value <v> or run in an interactive terminal without --yes.',
          }),
        );
      }
      if (!terminalIsInteractive) {
        return yield* Effect.fail(
          makeSecretCommandFailure({
            action: 'set',
            message:
              'A value is required. Pass --value <v> or run in an interactive terminal without --yes.',
          }),
        );
      }
      const prompt = yield* LaunchPrompt;
      secretValue = yield* prompt.requiredSecret(`Value for ${commandInput.name}`);
    }
    const secretReference = makeSecretReference(
      selectedApp.name,
      commandInput.profile,
      commandInput.name,
    );
    yield* setBuildSecret(secretReference, secretValue);
    const logger = yield* createLogger(false);
    yield* logger.ok(
      `Stored ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)} - in the keychain.`,
    );
  });

/** Remove one keychain-backed build secret. */
const removeSecretValue = (
  commandInput: Extract<SecretCommandInput, { action: 'rm' | 'remove' }>,
): Effect.Effect<void, unknown, SecretCommandRequirements> =>
  Effect.gen(function* () {
    if (commandInput.name === undefined) {
      return yield* Effect.fail(
        makeSecretCommandFailure({
          action: commandInput.action,
          message: 'Usage: launch secret rm <NAME> [--app <app>] [--profile <profile>].',
        }),
      );
    }
    const selectedApp = yield* selectStoreApp(commandInput.app);
    const secretReference = makeSecretReference(
      selectedApp.name,
      commandInput.profile,
      commandInput.name,
    );
    const secretExisted = yield* removeBuildSecret(secretReference);
    const logger = yield* createLogger(false);
    if (secretExisted) {
      yield* logger.ok(
        `Removed ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)}.`,
      );
      return;
    }
    yield* logger.skip(
      `No secret ${commandInput.name} for ${selectedApp.name} - ${scopeLabel(secretReference)}.`,
    );
  });

/** List non-secret build-secret coordinates without reading their values. */
const listSecrets = (
  commandInput: Extract<SecretCommandInput, { action: 'list' | 'status' }>,
): Effect.Effect<void, unknown, SecretCommandRequirements> =>
  Effect.gen(function* () {
    const secretReferences = yield* listSecretRefs(commandInput.app);
    const logger = yield* createLogger(false);
    if (secretReferences.length === 0) {
      if (commandInput.app !== undefined) {
        yield* logger.skip(
          `No build secrets for ${commandInput.app}. Add one with: launch secret set <NAME> --app ${commandInput.app}`,
        );
        return;
      }
      yield* logger.skip('No build secrets stored. Add one with: launch secret set <NAME>');
      return;
    }
    for (const secretReference of secretReferences) {
      yield* logger.line(
        `- ${secretReference.app} - ${secretReference.name} (${scopeLabel(secretReference)})`,
      );
    }
  });

/** Run one schema-decoded build-secret command. */
export const secretCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, SecretCommandFailure, SecretCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(SecretCommandInputSchema)(rawCommandInput);
    switch (commandInput.action) {
      case 'list':
      case 'status':
        return yield* listSecrets(commandInput);
      case 'set':
        return yield* setSecretValue(commandInput);
      case 'rm':
      case 'remove':
        return yield* removeSecretValue(commandInput);
    }
  }).pipe(
    Effect.mapError((cause) =>
      makeSecretCommandFailure({
        action: 'run',
        message: errorMessage(cause),
        cause,
      }),
    ),
  );
