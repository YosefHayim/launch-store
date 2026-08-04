import { FileSystem, Path, Terminal } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Redacted, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import { AppStoreIdentityService, type AppStoreIdentity } from '../services/appStoreIdentity.js';
import type { AppleCredentialsClientFactory } from '../services/appleCredentialsClient.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { parsePlatform } from '../services/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { AccountRecord, ApnsKeyRecord, AscKey } from '../types/credentials.js';
import {
  addAccount,
  formatAccountSummary,
  getActiveAccount,
  getActiveKeyId,
  listAccounts,
  loadAscKeyById,
  matchAccount,
  removeAccount,
  renameAccount,
  setActiveKeyId,
  updateAccountIdentity,
} from './accounts.js';
import {
  describeStoredAndroidCredentials,
  ensureUploadKeystore,
  storeServiceAccount,
  type KeystoreImport,
} from './androidKeystore.js';
import { describeStoredCredentials, ensureSigningCredentials } from './appleSigning.js';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './keyFiles.js';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './pushKeyStore.js';

const optionalCommandText = Schema.optionalWith(Schema.String, { exact: true });
const optionalCommandFlag = Schema.optionalWith(Schema.Boolean, { exact: true });

export const CredentialsActionSchema = Schema.Literal(
  'status',
  'accounts',
  'set-key',
  'setup',
  'use',
  'rename',
  'remove',
  'logout',
  'refresh',
  'push-key',
);

export const CredentialsCommandOptionsSchema = Schema.Struct({
  platform: optionalCommandText,
  keyId: optionalCommandText,
  issuerId: optionalCommandText,
  p8: optionalCommandText,
  label: optionalCommandText,
  account: optionalCommandText,
  app: optionalCommandText,
  import: optionalCommandText,
  alias: optionalCommandText,
  yes: optionalCommandFlag,
  teamId: optionalCommandText,
  out: optionalCommandText,
  force: optionalCommandFlag,
});

export const CredentialsCommandInputSchema = Schema.Struct({
  action: CredentialsActionSchema,
  firstArgument: optionalCommandText,
  secondArgument: optionalCommandText,
  options: CredentialsCommandOptionsSchema,
});

export type CredentialsAction = Schema.Schema.Type<typeof CredentialsActionSchema>;
export type CredentialsCommandOptions = Schema.Schema.Type<typeof CredentialsCommandOptionsSchema>;
export type CredentialsCommandInput = Schema.Schema.Type<typeof CredentialsCommandInputSchema>;

type CredentialsCommandRequirements =
  | AppStoreIdentityService
  | AppleCredentialsClientFactory
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal;

export type CredentialsCommandFailure = Readonly<{
  readonly _tag: 'CredentialsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeCredentialsCommandFailure = Data.tagged<CredentialsCommandFailure>(
  'CredentialsCommandFailure',
);

/** Turn an underlying typed failure into the command family's public failure. */
const commandFailure = (operation: string, cause: unknown): CredentialsCommandFailure =>
  makeCredentialsCommandFailure({ operation, message: errorMessage(cause), cause });

/** Stop a command branch with an actionable message. */
const failCommand = (
  operation: string,
  message: string,
): Effect.Effect<never, CredentialsCommandFailure> =>
  Effect.fail(makeCredentialsCommandFailure({ operation, message }));

/** Return the first defined text without truthiness fallback semantics. */
const firstDefinedText = (...candidates: readonly (string | undefined)[]): string | undefined => {
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate;
  }
  return undefined;
};

/** Build the ordered directories used for deliberate credential discovery. */
export const credentialSearchDirectories = (
  homeDirectory: string,
  workingDirectory: string,
): Effect.Effect<readonly string[], never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return [
      pathService.join(homeDirectory, 'Downloads'),
      pathService.join(homeDirectory, '.appstoreconnect', 'private_keys'),
      pathService.join(homeDirectory, '.launch', 'credentials'),
      pathService.join(workingDirectory, 'private_keys'),
      workingDirectory,
    ];
  });

/** Check whether a file sits directly inside one of the discovery directories. */
export const isCredentialDiscoveryFile = (
  filePath: string,
  searchDirectories: readonly string[],
): Effect.Effect<boolean, never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const containingDirectory = pathService.resolve(pathService.dirname(filePath));
    return searchDirectories.some(
      (searchDirectory) => pathService.resolve(searchDirectory) === containingDirectory,
    );
  });

/** Expand a leading home shorthand using the application-level path service. */
const expandHomePath = (
  enteredPath: string,
): Effect.Effect<string, never, Path.Path | LaunchPathsService> =>
  Effect.gen(function* () {
    if (!enteredPath.startsWith('~')) return enteredPath;
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    return pathService.join(launchPaths.homeDirectory, enteredPath.slice(1));
  });

/** Replace the configured home directory with a readable tilde prefix. */
const displayPath = (absolutePath: string): Effect.Effect<string, never, LaunchPathsService> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    if (!absolutePath.startsWith(launchPaths.homeDirectory)) return absolutePath;
    return `~${absolutePath.slice(launchPaths.homeDirectory.length)}`;
  });

/** Resolve whether this invocation is allowed to open an interactive prompt. */
const commandCanPrompt = (
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<boolean, never, Terminal.Terminal> =>
  Effect.gen(function* () {
    if (commandOptions.yes === true) return false;
    const terminal = yield* Terminal.Terminal;
    return yield* terminal.isTTY;
  });

/** Read a required string from a supplied source or the shared prompt service. */
const requireText = (
  suppliedText: string | undefined,
  promptMessage: string,
  nonInteractiveMessage: string,
  canPrompt: boolean,
): Effect.Effect<string, unknown, LaunchPromptService> =>
  Effect.gen(function* () {
    if (suppliedText !== undefined && suppliedText.trim().length > 0) return suppliedText.trim();
    if (!canPrompt) return yield* failCommand('read credentials input', nonInteractiveMessage);
    const prompt = yield* LaunchPrompt;
    return (yield* prompt.requiredText(promptMessage)).trim();
  });

/** Read a required secret from a supplied redacted source or the shared prompt service. */
const requireSecret = (
  suppliedSecret: Redacted.Redacted<string> | undefined,
  promptMessage: string,
  nonInteractiveMessage: string,
  canPrompt: boolean,
): Effect.Effect<string, unknown, LaunchPromptService> =>
  Effect.gen(function* () {
    if (suppliedSecret !== undefined) return Redacted.value(suppliedSecret);
    if (!canPrompt) return yield* failCommand('read credentials input', nonInteractiveMessage);
    const prompt = yield* LaunchPrompt;
    return yield* prompt.requiredSecret(promptMessage);
  });

/** Discover every App Store Connect key in the approved directories. */
const discoverAppleKeyFiles = (): Effect.Effect<
  readonly string[],
  never,
  FileSystem.FileSystem | Path.Path | LaunchPathsService
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const searchDirectories = yield* credentialSearchDirectories(
      launchPaths.homeDirectory,
      launchPaths.workingDirectory,
    );
    const discoveredGroups = yield* Effect.forEach(searchDirectories, findAuthKeyFiles, {
      concurrency: 'unbounded',
    });
    return discoveredGroups.flat();
  });

/** Resolve an explicit or discovered App Store Connect key file. */
const selectAppleKeyFile = (
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Effect.Effect<
  string,
  unknown,
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | Path.Path
> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const explicitPath = firstDefinedText(commandOptions.p8, environment.values.appleApiKeyPath);
    if (explicitPath !== undefined && explicitPath.length > 0) {
      const expandedPath = yield* expandHomePath(explicitPath);
      if (!(yield* fileSystem.exists(expandedPath))) {
        return yield* failCommand('select Apple key', `No .p8 file at ${explicitPath}.`);
      }
      return expandedPath;
    }
    const discoveredPaths = yield* discoverAppleKeyFiles();
    if (discoveredPaths.length === 1 && discoveredPaths[0] !== undefined) return discoveredPaths[0];
    if (discoveredPaths.length > 1) {
      if (!canPrompt && discoveredPaths[0] !== undefined) return discoveredPaths[0];
      const prompt = yield* LaunchPrompt;
      return yield* prompt.select({
        message: 'Multiple API keys found. Pick one:',
        choices: yield* Effect.forEach(discoveredPaths, (discoveredPath) =>
          displayPath(discoveredPath).pipe(
            Effect.map((shownPath) => ({ selection: discoveredPath, label: shownPath })),
          ),
        ),
      });
    }
    const enteredPath = yield* requireText(
      undefined,
      'Path to the App Store Connect .p8 file',
      'Pass --p8 <path> or set ASC_API_KEY_PATH.',
      canPrompt,
    );
    const expandedPath = yield* expandHomePath(enteredPath);
    if (!(yield* fileSystem.exists(expandedPath))) {
      return yield* failCommand('select Apple key', `No .p8 file at ${enteredPath}.`);
    }
    return expandedPath;
  });

/** Choose a unique account label for a newly imported key. */
const selectAccountLabel = (
  commandOptions: CredentialsCommandOptions,
  keyId: string,
  canPrompt: boolean,
): Effect.Effect<
  string,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | LaunchPromptService | Path.Path
> =>
  Effect.gen(function* () {
    let accountLabel = commandOptions.label;
    if (accountLabel === undefined && canPrompt) {
      const prompt = yield* LaunchPrompt;
      accountLabel = yield* prompt.requiredText('Label for this Apple account');
    }
    if (accountLabel === undefined) accountLabel = keyId;
    accountLabel = accountLabel.trim();
    if (accountLabel.length === 0) accountLabel = keyId;
    const accounts = yield* listAccounts();
    const conflictingAccount = accounts.find(
      (account) =>
        account.label.toLowerCase() === accountLabel.toLowerCase() && account.keyId !== keyId,
    );
    if (conflictingAccount !== undefined) {
      return yield* failCommand(
        'select account label',
        `Label "${accountLabel}" is already used by key ${conflictingAccount.keyId}.`,
      );
    }
    return accountLabel;
  });

/** Verify a new Apple key while tolerating only transient identity lookup failures. */
const verifyAppleKey = (
  ascKey: AscKey,
): Effect.Effect<AppStoreIdentity, unknown, AppStoreIdentityService | Logger> =>
  Effect.gen(function* () {
    const identityService = yield* AppStoreIdentityService;
    const logger = yield* createLogger(false);
    const verification = yield* identityService.verifyCredentials(ascKey).pipe(Effect.either);
    if (verification._tag === 'Right') return verification.right;
    if (verification.left.status === 401) {
      return yield* failCommand(
        'verify Apple key',
        'Apple rejected the key. Check that the Key ID, Issuer ID, and .p8 belong together.',
      );
    }
    if (verification.left.status === 403) {
      return yield* failCommand(
        'verify Apple key',
        'Apple rejected the key. Check that the Key ID, Issuer ID, and .p8 belong together.',
      );
    }
    yield* logger.warn(
      `Could not verify the key with Apple (${verification.left.message}). Saving it unresolved; run \`launch creds refresh\` later.`,
    );
    return { teamId: null, apps: [] };
  });

/** Offer removal only for a verified secret imported from a discovery directory. */
const offerSourceRemoval = (
  sourcePath: string,
  secretLabel: string,
  canPrompt: boolean,
): Effect.Effect<
  void,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | LaunchPromptService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const searchDirectories = yield* credentialSearchDirectories(
      launchPaths.homeDirectory,
      launchPaths.workingDirectory,
    );
    if (!(yield* isCredentialDiscoveryFile(sourcePath, searchDirectories))) return;
    const logger = yield* createLogger(false);
    const shownPath = yield* displayPath(sourcePath);
    if (!canPrompt) {
      yield* logger.warn(`Plaintext ${secretLabel} remains at ${shownPath}; it is safe to remove.`);
      return;
    }
    const prompt = yield* LaunchPrompt;
    const shouldRemove = yield* prompt.confirm(
      `Remove plaintext ${secretLabel} from ${shownPath}? It is now in the secret store.`,
    );
    if (!shouldRemove) {
      yield* logger.line(`Kept ${shownPath}.`);
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.remove(sourcePath, { force: true });
    yield* logger.ok(`Removed ${shownPath}.`);
  });

/** Import one App Store Connect key, cache its identity, and make it active. */
const importAppleKey = (
  p8Path: string,
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const filenameKeyId = yield* extractKeyId(p8Path);
    const configuredKeyId = firstDefinedText(commandOptions.keyId, environment.values.appleKeyId);
    let keyId = yield* reconcileKeyId(configuredKeyId, filenameKeyId);
    keyId = yield* requireText(
      keyId,
      'App Store Connect Key ID',
      'Pass --key-id <id> or set ASC_KEY_ID.',
      canPrompt,
    );
    const issuerId = yield* requireText(
      firstDefinedText(commandOptions.issuerId, environment.values.appleIssuerId),
      'App Store Connect Issuer ID',
      'Pass --issuer-id <id> or set ASC_ISSUER_ID.',
      canPrompt,
    );
    const accountLabel = yield* selectAccountLabel(commandOptions, keyId, canPrompt);
    const p8 = yield* fileSystem.readFileString(p8Path);
    const identity = yield* verifyAppleKey({ keyId, issuerId, p8 });
    yield* addAccount({
      keyId,
      issuerId,
      label: accountLabel,
      p8,
      teamId: identity.teamId,
      apps: identity.apps,
    });
    const logger = yield* createLogger(false);
    yield* logger.ok(`Added Apple account "${accountLabel}" (key ${keyId}) and set it active.`);
    if (identity.apps.length > 0) {
      yield* logger.line(`Visible apps: ${identity.apps.slice(0, 3).join(', ')}.`);
    }
    if (identity.teamId !== null) {
      yield* offerSourceRemoval(p8Path, 'App Store Connect key', canPrompt);
    }
  });

/** Import an Apple account from an explicit or discovered key file. */
const setAppleKey = (
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const p8Path = yield* selectAppleKeyFile(commandOptions, canPrompt);
    yield* importAppleKey(p8Path, commandOptions, canPrompt);
  });

/** Import a Google Play service-account key into the configured secret store. */
const setGoogleKey = (
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const enteredPath = yield* requireText(
      firstDefinedText(pathArgument, environment.values.playServiceAccountPath),
      'Path to the Play service-account JSON',
      'Pass the service-account JSON path or set PLAY_SERVICE_ACCOUNT.',
      canPrompt,
    );
    const keyPath = yield* expandHomePath(enteredPath);
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(keyPath))) {
      return yield* failCommand('import Google key', `No service-account JSON at ${enteredPath}.`);
    }
    yield* storeServiceAccount(yield* fileSystem.readFileString(keyPath));
    const logger = yield* createLogger(false);
    yield* logger.ok(`Stored the Play service account from ${yield* displayPath(keyPath)}.`);
    yield* offerSourceRemoval(keyPath, 'Play service-account key', canPrompt);
  });

/** Choose one configured application by handle or through the shared prompt service. */
const selectConfiguredApp = (
  apps: readonly AppDescriptor[],
  requestedApp: string | undefined,
  canPrompt: boolean,
): Effect.Effect<AppDescriptor, unknown, LaunchPromptService> =>
  Effect.gen(function* () {
    if (requestedApp !== undefined) {
      const matchedApp = apps.find((configuredApp) => configuredApp.name === requestedApp);
      if (matchedApp !== undefined) return matchedApp;
      return yield* failCommand('select app', `No configured app named "${requestedApp}".`);
    }
    if (apps.length === 1 && apps[0] !== undefined) return apps[0];
    if (!canPrompt) return yield* failCommand('select app', 'Pass --app <name>.');
    if (apps.length === 0)
      return yield* failCommand('select app', 'No applications were discovered.');
    const prompt = yield* LaunchPrompt;
    return yield* prompt.select({
      message: 'Choose an app:',
      choices: apps.map((configuredApp) => ({
        selection: configuredApp,
        label: configuredApp.name,
      })),
    });
  });

/** Select an Apple account by flag, environment, active pointer, or prompt. */
const selectAppleAccount = (
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Effect.Effect<AccountRecord, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const accounts = yield* listAccounts();
    const selector = firstDefinedText(commandOptions.account, environment.values.appleAccount);
    if (selector !== undefined) {
      const matchedAccount = matchAccount([...accounts], selector);
      if (matchedAccount !== undefined) return matchedAccount;
      return yield* failCommand('select Apple account', `No Apple account matching "${selector}".`);
    }
    const activeAccount = yield* getActiveAccount();
    if (activeAccount !== null) return activeAccount;
    if (!canPrompt) {
      return yield* failCommand(
        'select Apple account',
        'No active Apple account. Import one with `launch creds set-key`.',
      );
    }
    return yield* chooseAccountInteractive(commandOptions);
  });

/** Present the account chooser used by `creds use` and the interactive wizard. */
export const chooseAccountInteractive = (
  commandOptions: CredentialsCommandOptions = {},
): Effect.Effect<AccountRecord, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const accounts = yield* listAccounts();
    const activeKeyId = yield* getActiveKeyId();
    const prompt = yield* LaunchPrompt;
    if (accounts.length === 0) {
      const p8Path = yield* selectAppleKeyFile(commandOptions, true);
      yield* importAppleKey(p8Path, commandOptions, true);
      const importedAccount = yield* getActiveAccount();
      if (importedAccount === null) {
        return yield* failCommand('choose Apple account', 'No active account after import.');
      }
      return importedAccount;
    }
    const chosenAccount = yield* prompt.select({
      message: 'Choose an Apple account:',
      choices: accounts.map((account) => {
        let accountLabel = account.label;
        if (account.keyId === activeKeyId) accountLabel = `${accountLabel} (active)`;
        return {
          selection: account,
          label: accountLabel,
          hint: formatAccountSummary(account, { includeLabel: false }),
        };
      }),
    });
    yield* setActiveKeyId(chosenAccount.keyId);
    const logger = yield* createLogger(false);
    yield* logger.ok(`Active Apple account: ${chosenAccount.label} (key ${chosenAccount.keyId}).`);
    return chosenAccount;
  });

/** Provision or reuse signing credentials for one Apple application. */
export const setupIos = (
  commandOptions: CredentialsCommandOptions,
  platform: Platform = 'ios',
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const account = yield* selectAppleAccount(commandOptions, canPrompt);
    const ascKey = yield* loadAscKeyById(account.keyId);
    if (ascKey === null) {
      return yield* failCommand(
        'set up Apple signing',
        `Account "${account.label}" has no stored key. Re-import it with \`launch creds set-key\`.`,
      );
    }
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const app = yield* selectConfiguredApp(loadedConfig.apps, commandOptions.app, canPrompt);
    if (app.bundleId === undefined) {
      return yield* failCommand(
        'set up Apple signing',
        `No Apple bundle identifier is configured for ${app.name}.`,
      );
    }
    const logger = yield* createLogger(false);
    const prompt = yield* LaunchPrompt;
    const signingAssets = yield* ensureSigningCredentials({
      platform,
      bundleId: app.bundleId,
      appName: app.name,
      ascKey,
      log: logger,
      dryRun: false,
      confirmCreate: (message) => {
        if (!canPrompt) return Effect.succeed(true);
        return prompt.confirm(message);
      },
    });
    yield* logger.ok(
      `Ready (${account.label}): certificate ${signingAssets.certSerial}, profile ${signingAssets.profileName}.`,
    );
  });

/** Read optional import settings for an existing Android upload keystore. */
const selectKeystoreImport = (
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Effect.Effect<KeystoreImport | undefined, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    if (commandOptions.import === undefined) return undefined;
    const importedPath = yield* expandHomePath(commandOptions.import);
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(importedPath))) {
      return yield* failCommand(
        'import Android keystore',
        `No keystore at ${commandOptions.import}.`,
      );
    }
    const environment = yield* LaunchEnvironment;
    const alias = yield* requireText(
      commandOptions.alias,
      'Key alias inside the keystore',
      'Pass --alias <alias>.',
      canPrompt,
    );
    const storePassword = yield* requireSecret(
      environment.values.androidKeystorePassword,
      'Keystore password',
      'Set ANDROID_KEYSTORE_PASSWORD.',
      canPrompt,
    );
    let keyPassword = storePassword;
    if (environment.values.androidKeyPassword !== undefined) {
      keyPassword = Redacted.value(environment.values.androidKeyPassword);
    }
    return { path: importedPath, alias, storePassword, keyPassword };
  });

/** Provision or import the upload keystore for one Android application. */
const setupAndroid = (
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const app = yield* selectConfiguredApp(loadedConfig.apps, commandOptions.app, canPrompt);
    const keystoreImport = yield* selectKeystoreImport(commandOptions, canPrompt);
    const logger = yield* createLogger(false);
    const prompt = yield* LaunchPrompt;
    const keystoreRequest = {
      appName: app.name,
      log: logger,
      dryRun: false,
      confirmCreate: (message: string) => {
        if (!canPrompt) return Effect.succeed(true);
        return prompt.confirm(message);
      },
    };
    let keystoreEffect = ensureUploadKeystore(keystoreRequest);
    if (keystoreImport !== undefined) {
      keystoreEffect = ensureUploadKeystore({ ...keystoreRequest, import: keystoreImport });
    }
    const keystore = yield* keystoreEffect;
    yield* logger.ok(
      `Ready: upload keystore at ${yield* displayPath(keystore.path)} (alias ${keystore.alias}).`,
    );
  });

/** Render the current Apple, Android, and APNs credential inventory. */
const showCredentialStatus = (): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const accounts = yield* listAccounts();
    const activeKeyId = yield* getActiveKeyId();
    if (accounts.length === 0) {
      yield* logger.line('Apple accounts: none');
    }
    for (const account of accounts) {
      const storedSigning = yield* describeStoredCredentials(account.keyId);
      let activeMarker = '';
      if (account.keyId === activeKeyId) activeMarker = ' (active)';
      yield* logger.line(`Apple account: ${formatAccountSummary(account)}${activeMarker}`);
      if (storedSigning.certSerial !== null) {
        yield* logger.line(`  certificate: ${storedSigning.certSerial}`);
      }
      if (storedSigning.bundleIds.length > 0) {
        yield* logger.line(`  profiles: ${storedSigning.bundleIds.join(', ')}`);
      }
    }
    const androidCredentials = yield* describeStoredAndroidCredentials();
    let serviceAccountStatus = 'not stored';
    if (androidCredentials.hasServiceAccount) serviceAccountStatus = 'stored';
    yield* logger.line(`Google service account: ${serviceAccountStatus}`);
    if (androidCredentials.keystoreAlias !== null) {
      yield* logger.line(`Android upload keystore: alias ${androidCredentials.keystoreAlias}`);
    }
    const pushKeys = yield* listPushKeys();
    yield* logger.line(`APNs keys: ${pushKeys.length}`);
  });

/** Switch the active Apple account by selector or interactive choice. */
const useAppleAccount = (
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    if (selector === undefined) {
      if (!(yield* commandCanPrompt(commandOptions))) {
        return yield* failCommand('use Apple account', 'Pass an account label or Key ID.');
      }
      yield* chooseAccountInteractive(commandOptions);
      return;
    }
    const accounts = yield* listAccounts();
    const matchedAccount = matchAccount([...accounts], selector);
    if (matchedAccount === undefined) {
      return yield* failCommand('use Apple account', `No Apple account matching "${selector}".`);
    }
    yield* setActiveKeyId(matchedAccount.keyId);
    const logger = yield* createLogger(false);
    yield* logger.ok(
      `Active Apple account: ${matchedAccount.label} (key ${matchedAccount.keyId}).`,
    );
  });

/** Rename one Apple account while keeping labels unique. */
const renameAppleAccount = (
  selector: string | undefined,
  enteredLabel: string | undefined,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    if (selector === undefined) {
      return yield* failCommand(
        'rename Apple account',
        'Usage: launch creds rename <account> <new-label>.',
      );
    }
    if (enteredLabel === undefined) {
      return yield* failCommand(
        'rename Apple account',
        'Usage: launch creds rename <account> <new-label>.',
      );
    }
    const accounts = yield* listAccounts();
    const matchedAccount = matchAccount([...accounts], selector);
    if (matchedAccount === undefined) {
      return yield* failCommand('rename Apple account', `No Apple account matching "${selector}".`);
    }
    const accountLabel = enteredLabel.trim();
    const conflictingAccount = accounts.find(
      (account) =>
        account.label.toLowerCase() === accountLabel.toLowerCase() &&
        account.keyId !== matchedAccount.keyId,
    );
    if (conflictingAccount !== undefined) {
      return yield* failCommand(
        'rename Apple account',
        `Label "${accountLabel}" is already used by key ${conflictingAccount.keyId}.`,
      );
    }
    yield* renameAccount(matchedAccount.keyId, accountLabel);
    const logger = yield* createLogger(false);
    yield* logger.ok(`Renamed account ${matchedAccount.keyId} to "${accountLabel}".`);
  });

/** Remove one Apple account after an optional interactive confirmation. */
const removeAppleAccount = (
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    if (selector === undefined) {
      return yield* failCommand('remove Apple account', 'Usage: launch creds remove <account>.');
    }
    const accounts = yield* listAccounts();
    const matchedAccount = matchAccount([...accounts], selector);
    if (matchedAccount === undefined) {
      return yield* failCommand('remove Apple account', `No Apple account matching "${selector}".`);
    }
    if (yield* commandCanPrompt(commandOptions)) {
      const prompt = yield* LaunchPrompt;
      const confirmed = yield* prompt.confirm(
        `Remove account "${matchedAccount.label}" and its signing assets?`,
      );
      if (!confirmed) return;
    }
    yield* removeAccount(matchedAccount.keyId);
    const logger = yield* createLogger(false);
    yield* logger.ok(`Removed Apple account "${matchedAccount.label}".`);
  });

/** Refresh cached team and application names for one or every Apple account. */
const refreshAppleAccounts = (
  selector: string | undefined,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const accounts = yield* listAccounts();
    let refreshTargets = [...accounts];
    if (selector !== undefined) {
      const matchedAccount = matchAccount([...accounts], selector);
      if (matchedAccount === undefined) {
        return yield* failCommand(
          'refresh Apple accounts',
          `No Apple account matching "${selector}".`,
        );
      }
      refreshTargets = [matchedAccount];
    }
    if (refreshTargets.length === 0) {
      return yield* failCommand('refresh Apple accounts', 'No Apple accounts to refresh.');
    }
    const identityService = yield* AppStoreIdentityService;
    const logger = yield* createLogger(false);
    yield* Effect.forEach(
      refreshTargets,
      (account) =>
        Effect.gen(function* () {
          const ascKey = yield* loadAscKeyById(account.keyId);
          if (ascKey === null) {
            yield* logger.warn(`Skipped "${account.label}": no stored key.`);
            return;
          }
          const identity = yield* identityService.resolveIdentity(ascKey);
          yield* updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
          yield* logger.ok(`Refreshed "${account.label}" (${identity.apps.length} apps).`);
        }),
      { concurrency: 1 },
    );
  });

/** Render APNs key metadata without exposing secret material. */
const showPushKeys = (): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const pushKeys = yield* listPushKeys();
    if (pushKeys.length === 0) {
      yield* logger.line('No APNs keys in the vault.');
      return;
    }
    for (const pushKey of pushKeys) {
      const details: string[] = [];
      if (pushKey.label !== undefined && pushKey.label !== pushKey.keyId)
        details.push(pushKey.label);
      if (pushKey.teamId !== undefined) details.push(`team ${pushKey.teamId}`);
      let detailText = '';
      if (details.length > 0) detailText = ` - ${details.join(' - ')}`;
      yield* logger.line(`- ${pushKey.keyId}${detailText}`);
    }
  });

/** Import one APNs key while preserving the download-once source file. */
const importApnsKey = (
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const enteredPath = yield* requireText(
      firstDefinedText(pathArgument, commandOptions.p8),
      'Path to the APNs .p8 key',
      'Pass the APNs .p8 path.',
      canPrompt,
    );
    const keyPath = yield* expandHomePath(enteredPath);
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(keyPath))) {
      return yield* failCommand('import APNs key', `No .p8 file at ${enteredPath}.`);
    }
    const filenameKeyId = yield* extractKeyId(keyPath);
    let keyId = yield* reconcileKeyId(commandOptions.keyId, filenameKeyId);
    keyId = yield* requireText(
      keyId,
      'APNs Key ID',
      'Pass --key-id <id> or name the file AuthKey_<KEYID>.p8.',
      canPrompt,
    );
    const activeAccount = yield* getActiveAccount();
    let teamId = commandOptions.teamId;
    if (teamId === undefined && activeAccount !== null) teamId = activeAccount.teamId;
    let keyLabel = commandOptions.label;
    if (keyLabel === undefined) keyLabel = keyId;
    const p8 = yield* fileSystem.readFileString(keyPath);
    const importRequest: {
      keyId: string;
      p8: string;
      label: string;
      teamId?: string;
    } = { keyId, p8, label: keyLabel };
    if (teamId !== undefined) importRequest.teamId = teamId;
    yield* importPushKey(importRequest);
    const logger = yield* createLogger(false);
    yield* logger.ok(`Imported APNs key ${keyId}.`);
    yield* logger.warn(`Keep ${yield* displayPath(keyPath)}; Apple permits only one download.`);
  });

/** Export one vaulted APNs key to a permission-restricted file. */
const exportApnsKey = (
  keyIdArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    if (keyIdArgument === undefined) {
      return yield* failCommand(
        'export APNs key',
        'Usage: launch creds push-key export <keyId> --out <path>.',
      );
    }
    const keyRecord = yield* findPushKey(keyIdArgument);
    if (keyRecord === undefined) {
      return yield* failCommand('export APNs key', `No APNs key "${keyIdArgument}" exists.`);
    }
    const p8 = yield* loadPushKey(keyRecord.keyId);
    if (p8 === null) {
      return yield* failCommand(
        'export APNs key',
        `APNs key ${keyRecord.keyId} has no stored secret.`,
      );
    }
    const canPrompt = yield* commandCanPrompt(commandOptions);
    const enteredPath = yield* requireText(
      commandOptions.out,
      'Write the APNs .p8 to',
      'Pass --out <path>.',
      canPrompt,
    );
    const outputPath = yield* expandHomePath(enteredPath);
    const fileSystem = yield* FileSystem.FileSystem;
    if ((yield* fileSystem.exists(outputPath)) && commandOptions.force !== true) {
      return yield* failCommand(
        'export APNs key',
        `${yield* displayPath(outputPath)} already exists. Pass --force to overwrite.`,
      );
    }
    if (canPrompt) {
      const prompt = yield* LaunchPrompt;
      const confirmed = yield* prompt.confirm(
        `Write secret APNs key ${keyRecord.keyId} to ${yield* displayPath(outputPath)}?`,
      );
      if (!confirmed) return;
    }
    yield* fileSystem.writeFileString(outputPath, p8, { mode: 0o600 });
    const logger = yield* createLogger(false);
    yield* logger.ok(`Wrote APNs key ${keyRecord.keyId} to ${yield* displayPath(outputPath)}.`);
  });

/** Dispatch the APNs vault subcommand. */
const runPushKeyAction = (
  pushAction: string | undefined,
  keyArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Effect.Effect<void, unknown, CredentialsCommandRequirements> => {
  switch (pushAction) {
    case undefined:
    case 'status':
      return showPushKeys();
    case 'import':
      return importApnsKey(keyArgument, commandOptions);
    case 'export':
      return exportApnsKey(keyArgument, commandOptions);
    default:
      return failCommand(
        'run APNs command',
        `Unknown push-key action "${pushAction}". Use import, status, or export.`,
      );
  }
};

/** Decode and execute one credentials command through the shared Effect services. */
export const credentialsCommandProgram = (
  commandInput: unknown,
): Effect.Effect<void, CredentialsCommandFailure, CredentialsCommandRequirements> =>
  Effect.gen(function* () {
    const decodedCommand = yield* Schema.decodeUnknown(CredentialsCommandInputSchema)(commandInput);
    let platformText = decodedCommand.options.platform;
    if (platformText === undefined) platformText = 'ios';
    const platform = yield* parsePlatform(platformText);
    switch (decodedCommand.action) {
      case 'status':
      case 'accounts':
        return yield* showCredentialStatus();
      case 'set-key':
        if (platform === 'android') {
          return yield* setGoogleKey(decodedCommand.firstArgument, decodedCommand.options);
        }
        return yield* setAppleKey(decodedCommand.options);
      case 'setup':
        if (platform === 'android') return yield* setupAndroid(decodedCommand.options);
        return yield* setupIos(decodedCommand.options, platform);
      case 'use':
        return yield* useAppleAccount(decodedCommand.firstArgument, decodedCommand.options);
      case 'rename':
        return yield* renameAppleAccount(
          decodedCommand.firstArgument,
          decodedCommand.secondArgument,
        );
      case 'remove':
      case 'logout':
        return yield* removeAppleAccount(decodedCommand.firstArgument, decodedCommand.options);
      case 'refresh':
        return yield* refreshAppleAccounts(decodedCommand.firstArgument);
      case 'push-key':
        return yield* runPushKeyAction(
          decodedCommand.firstArgument,
          decodedCommand.secondArgument,
          decodedCommand.options,
        );
    }
  }).pipe(Effect.mapError((cause) => commandFailure('run credentials command', cause)));

export type { ApnsKeyRecord };
