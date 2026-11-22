import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathExists } from '@/path-exists.js';
import { loadConfig } from '@/config/config.js';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '@/services/platform/atomicDocumentFile.js';
import { errorMessage } from '@/services/platform/errorMessage.js';
import { readLaunchEnvironment } from '@/services/platform/environment.js';
import { createLogger, type Logger } from '@/services/platform/logger.js';
import { locatePortfolioFilePath, readLaunchDirectories } from '@/services/platform/paths.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import {
  AppStoreIdentityService,
  type AppStoreIdentity,
} from '@/services/stores/appStoreIdentity.js';
import { GoogleStoreClientService } from '@/services/stores/googleStoreClient.js';
import { parsePlatform } from '@/services/stores/platform.js';
import { pickSavedPortfolioFile } from '@/portfolio/portfolioStore.js';
import { parsePlayReportsBucket } from '@/stats/playReportsBucket.js';
import type { AppDescriptor, Platform } from '@/types/app.js';
import type { AccountRecord, AscKey } from '@/types/credentials.js';
import type { PortfolioFile } from '@/types/portfolio.js';
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
  setAccountVendorNumber,
  setActiveKeyId,
  updateAccountIdentity,
} from './accounts.js';
import {
  adoptLegacyAndroidCredentials,
  describeStoredAndroidCredentials,
  ensureUploadKeystore,
  storeServiceAccount,
  type KeystoreImport,
} from './androidKeystore.js';
import { describeStoredCredentials, ensureSigningCredentials } from './appleSigning.js';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './keyFiles.js';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from './pushKeyStore.js';

const CREDENTIAL_ACTIONS = [
  'status',
  'adopt',
  'accounts',
  'set-key',
  'setup',
  'use',
  'rename',
  'remove',
  'logout',
  'refresh',
  'push-key',
  'set-vendor-number',
  'set-play-reports-bucket',
] as const;

type CredentialsAction = (typeof CREDENTIAL_ACTIONS)[number];

const OPTION_TEXT_FIELDS = [
  'platform',
  'keyId',
  'issuerId',
  'p8',
  'label',
  'account',
  'app',
  'import',
  'alias',
  'teamId',
  'out',
  'vendorNumber',
  'playReportsBucket',
] as const;

export type CredentialsCommandOptions = {
  platform?: string;
  keyId?: string;
  issuerId?: string;
  p8?: string;
  label?: string;
  account?: string;
  app?: string;
  import?: string;
  alias?: string;
  yes?: boolean;
  teamId?: string;
  out?: string;
  force?: boolean;
  vendorNumber?: string;
  playReportsBucket?: string;
};

type CredentialsCommandInput = {
  action: CredentialsAction;
  firstArgument?: string;
  secondArgument?: string;
  options: CredentialsCommandOptions;
};

export type CredentialsCommandFailure = Readonly<{
  readonly _tag: 'CredentialsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeCredentialsCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): CredentialsCommandFailure {
  if (fields.cause != null) {
    return {
      _tag: 'CredentialsCommandFailure',
      operation: fields.operation,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'CredentialsCommandFailure',
    operation: fields.operation,
    message: fields.message,
  };
}

function isCredentialsCommandFailure(cause: unknown): cause is CredentialsCommandFailure {
  if (typeof cause != 'object') {
    return false;
  }

  if (cause == null) {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'CredentialsCommandFailure';
}

function commandFailure(operation: string, cause: unknown): CredentialsCommandFailure {
  return makeCredentialsCommandFailure({ operation, message: errorMessage(cause), cause });
}

function failCommand(operation: string, message: string): never {
  throw makeCredentialsCommandFailure({ operation, message });
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'string') {
    throw new Error(`Credentials ${fieldName} must be a string.`);
  }

  return field;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  fieldName: string,
): boolean | undefined {
  const hasField = Object.hasOwn(record, fieldName);

  if (hasField == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'boolean') {
    throw new Error(`Credentials ${fieldName} must be a boolean.`);
  }

  return field;
}

function readAction(candidate: unknown): CredentialsAction {
  for (const action of CREDENTIAL_ACTIONS) {
    if (candidate == action) {
      return action;
    }
  }

  throw new Error(`Unknown credentials action "${String(candidate)}".`);
}

function readCommandOptions(record: Record<string, unknown>): CredentialsCommandOptions {
  const options: CredentialsCommandOptions = {};

  for (const fieldName of OPTION_TEXT_FIELDS) {
    const fieldText = readOptionalString(record, fieldName);

    if (fieldText != null) {
      options[fieldName] = fieldText;
    }
  }

  const yes = readOptionalBoolean(record, 'yes');
  const force = readOptionalBoolean(record, 'force');

  if (yes != null) {
    options.yes = yes;
  }

  if (force != null) {
    options.force = force;
  }

  return options;
}

export function CredentialsCommandInputSchema(commandInput: unknown): CredentialsCommandInput {
  if (isRecord(commandInput) == false) {
    throw new Error('Credentials command input must be an object.');
  }

  const action = readAction(commandInput['action']);
  const optionsRecord = commandInput['options'];

  if (isRecord(optionsRecord) == false) {
    throw new Error('Credentials command options must be an object.');
  }

  let decoded: CredentialsCommandInput = {
    action,
    options: readCommandOptions(optionsRecord),
  };
  const firstArgument = readOptionalString(commandInput, 'firstArgument');
  const secondArgument = readOptionalString(commandInput, 'secondArgument');

  if (firstArgument != null) {
    decoded = { ...decoded, firstArgument };
  }

  if (secondArgument != null) {
    decoded = { ...decoded, secondArgument };
  }

  return decoded;
}

function firstDefinedText(...candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate != null) {
      return candidate;
    }
  }

  return undefined;
}

function requireMatchedAccount(
  accounts: readonly AccountRecord[],
  selector: string,
  operation: string,
): AccountRecord {
  const matchedAccount = matchAccount([...accounts], selector);

  if (matchedAccount == null) {
    failCommand(operation, `No Apple account matching "${selector}".`);
  }

  return matchedAccount;
}

function findLabelConflict(
  accounts: readonly AccountRecord[],
  accountLabel: string,
  excludingKeyId: string,
): AccountRecord | null {
  const requestedLabel = accountLabel.toLowerCase();

  for (const account of accounts) {
    const isSameLabel = account.label.toLowerCase() == requestedLabel;

    if (isSameLabel == false) {
      continue;
    }

    const isDifferentKey = account.keyId != excludingKeyId;

    if (isDifferentKey) {
      return account;
    }
  }

  return null;
}

function requireUniqueAccountLabel(
  accounts: readonly AccountRecord[],
  accountLabel: string,
  excludingKeyId: string,
  operation: string,
): void {
  const conflictingAccount = findLabelConflict(accounts, accountLabel, excludingKeyId);

  if (conflictingAccount != null) {
    failCommand(
      operation,
      `Label "${accountLabel}" is already used by key ${conflictingAccount.keyId}.`,
    );
  }
}

export function credentialSearchDirectories(
  homeDirectory: string,
  workingDirectory: string,
): readonly string[] {
  return [
    join(homeDirectory, 'Downloads'),
    join(homeDirectory, '.appstoreconnect', 'private_keys'),
    join(homeDirectory, '.launch', 'credentials'),
    join(workingDirectory, 'private_keys'),
    workingDirectory,
  ];
}

export function isCredentialDiscoveryFile(
  filePath: string,
  searchDirectories: readonly string[],
): boolean {
  const containingDirectory = resolve(dirname(filePath));

  for (const searchDirectory of searchDirectories) {
    const isSameDirectory = resolve(searchDirectory) == containingDirectory;

    if (isSameDirectory) {
      return true;
    }
  }

  return false;
}

function expandHomePath(enteredPath: string): string {
  const isHomeShorthand = enteredPath.startsWith('~');

  if (isHomeShorthand == false) {
    return enteredPath;
  }

  return join(readLaunchDirectories().homeDirectory, enteredPath.slice(1));
}

function displayPath(absolutePath: string): string {
  const homeDirectory = readLaunchDirectories().homeDirectory;
  const isInsideHome = absolutePath.startsWith(homeDirectory);

  if (isInsideHome == false) {
    return absolutePath;
  }

  return `~${absolutePath.slice(homeDirectory.length)}`;
}

function commandCanPrompt(commandOptions: CredentialsCommandOptions): boolean {
  if (commandOptions.yes == true) {
    return false;
  }

  return process.stdout.isTTY == true;
}

function suppliedText(supplied: string | undefined): string | null {
  if (supplied == null) {
    return null;
  }

  const trimmed = supplied.trim();

  if (trimmed.length == 0) {
    return null;
  }

  return trimmed;
}

async function requireText(
  supplied: string | undefined,
  promptMessage: string,
  nonInteractiveMessage: string,
  canPrompt: boolean,
): Promise<string> {
  const trimmed = suppliedText(supplied);

  if (trimmed != null) {
    return trimmed;
  }

  if (canPrompt == false) {
    failCommand('read credentials input', nonInteractiveMessage);
  }

  const entered = await LaunchPrompt.requiredText(promptMessage);

  return entered.trim();
}

async function requireSecret(
  suppliedSecret: string | undefined,
  promptMessage: string,
  nonInteractiveMessage: string,
  canPrompt: boolean,
): Promise<string> {
  if (suppliedSecret != null) {
    return suppliedSecret;
  }

  if (canPrompt == false) {
    failCommand('read credentials input', nonInteractiveMessage);
  }

  return LaunchPrompt.requiredSecret(promptMessage);
}

async function discoverAppleKeyFiles(): Promise<readonly string[]> {
  const launchPaths = readLaunchDirectories();
  const searchDirectories = credentialSearchDirectories(
    launchPaths.homeDirectory,
    launchPaths.workingDirectory,
  );
  const discoveredGroups = await Promise.all(searchDirectories.map(findAuthKeyFiles));

  return discoveredGroups.flat();
}

async function selectDiscoveredKey(
  discoveredPaths: readonly string[],
  canPrompt: boolean,
): Promise<string | null> {
  const onlyPath = discoveredPaths[0];

  if (discoveredPaths.length == 1) {
    if (onlyPath != null) {
      return onlyPath;
    }
  }

  if (discoveredPaths.length < 2) {
    return null;
  }

  if (canPrompt == false) {
    if (onlyPath != null) {
      return onlyPath;
    }
  }

  const choices = discoveredPaths.map(function keyChoice(discoveredPath: string) {
    return { selection: discoveredPath, label: displayPath(discoveredPath) };
  });

  return LaunchPrompt.select({
    message: 'Multiple API keys found. Pick one:',
    choices,
  });
}

async function selectAppleKeyFile(
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Promise<string> {
  const environment = readLaunchEnvironment();
  const explicitPath = firstDefinedText(commandOptions.p8, environment.values.appleApiKeyPath);

  if (explicitPath != null) {
    const hasPathText = explicitPath.length > 0;

    if (hasPathText) {
      const expandedPath = expandHomePath(explicitPath);
      const keyExists = await pathExists(expandedPath);

      if (keyExists == false) {
        failCommand('select Apple key', `No .p8 file at ${explicitPath}.`);
      }

      return expandedPath;
    }
  }

  const discoveredPaths = await discoverAppleKeyFiles();
  const discoveredPath = await selectDiscoveredKey(discoveredPaths, canPrompt);

  if (discoveredPath != null) {
    return discoveredPath;
  }

  const enteredPath = await requireText(
    undefined,
    'Path to the App Store Connect .p8 file',
    'Pass --p8 <path> or set ASC_API_KEY_PATH.',
    canPrompt,
  );
  const expandedPath = expandHomePath(enteredPath);
  const enteredKeyExists = await pathExists(expandedPath);

  if (enteredKeyExists == false) {
    failCommand('select Apple key', `No .p8 file at ${enteredPath}.`);
  }

  return expandedPath;
}

async function selectAccountLabel(
  commandOptions: CredentialsCommandOptions,
  keyId: string,
  canPrompt: boolean,
): Promise<string> {
  let accountLabel = commandOptions.label;
  const needsPrompt = accountLabel == null;

  if (needsPrompt) {
    if (canPrompt) {
      accountLabel = await LaunchPrompt.requiredText('Label for this Apple account');
    }
  }

  if (accountLabel == null) {
    accountLabel = keyId;
  }

  accountLabel = accountLabel.trim();

  if (accountLabel.length == 0) {
    accountLabel = keyId;
  }

  const accounts = await listAccounts();

  requireUniqueAccountLabel(accounts, accountLabel, keyId, 'select account label');

  return accountLabel;
}

function readFailureStatus(cause: unknown): number | null {
  if (typeof cause != 'object') {
    return null;
  }

  if (cause == null) {
    return null;
  }

  if ('status' in cause == false) {
    return null;
  }

  const status = cause.status;

  if (typeof status != 'number') {
    return null;
  }

  return status;
}

function isRejectedAppleStatus(status: number | null): boolean {
  if (status == 401) {
    return true;
  }

  if (status == 403) {
    return true;
  }

  return false;
}

async function verifyAppleKey(ascKey: AscKey): Promise<AppStoreIdentity> {
  const logger = createLogger(false);

  try {
    return await AppStoreIdentityService.verifyCredentials(ascKey);
  } catch (cause) {
    const status = readFailureStatus(cause);

    if (isRejectedAppleStatus(status)) {
      failCommand(
        'verify Apple key',
        'Apple rejected the key. Check that the Key ID, Issuer ID, and .p8 belong together.',
      );
    }

    logger.warn(
      `Could not verify the key with Apple (${errorMessage(cause)}). Saving it unresolved; run \`launch creds refresh\` later.`,
    );

    return { teamId: null, apps: [] };
  }
}

async function offerSourceRemoval(
  sourcePath: string,
  secretLabel: string,
  canPrompt: boolean,
): Promise<void> {
  const launchPaths = readLaunchDirectories();
  const searchDirectories = credentialSearchDirectories(
    launchPaths.homeDirectory,
    launchPaths.workingDirectory,
  );
  const isDiscoveryFile = isCredentialDiscoveryFile(sourcePath, searchDirectories);

  if (isDiscoveryFile == false) {
    return;
  }

  const logger = createLogger(false);
  const shownPath = displayPath(sourcePath);

  if (canPrompt == false) {
    logger.warn(`Plaintext ${secretLabel} remains at ${shownPath}; it is safe to remove.`);

    return;
  }

  const shouldRemove = await LaunchPrompt.confirm(
    `Remove plaintext ${secretLabel} from ${shownPath}? It is now in the secret store.`,
  );

  if (shouldRemove == false) {
    logger.line(`Kept ${shownPath}.`);

    return;
  }

  await rm(sourcePath, { force: true });
  logger.ok(`Removed ${shownPath}.`);
}

async function importAppleKey(
  p8Path: string,
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Promise<void> {
  const environment = readLaunchEnvironment();
  const filenameKeyId = extractKeyId(p8Path);
  const configuredKeyId = firstDefinedText(commandOptions.keyId, environment.values.appleKeyId);
  let keyId = reconcileKeyId(configuredKeyId, filenameKeyId);

  keyId = await requireText(
    keyId,
    'App Store Connect Key ID',
    'Pass --key-id <id> or set ASC_KEY_ID.',
    canPrompt,
  );

  const issuerId = await requireText(
    firstDefinedText(commandOptions.issuerId, environment.values.appleIssuerId),
    'App Store Connect Issuer ID',
    'Pass --issuer-id <id> or set ASC_ISSUER_ID.',
    canPrompt,
  );
  const accountLabel = await selectAccountLabel(commandOptions, keyId, canPrompt);
  const p8 = await readFile(p8Path, 'utf8');
  const identity = await verifyAppleKey({ keyId, issuerId, p8 });

  await addAccount({
    keyId,
    issuerId,
    label: accountLabel,
    p8,
    teamId: identity.teamId,
    apps: identity.apps,
  });

  const logger = createLogger(false);

  logger.ok(`Added Apple account "${accountLabel}" (key ${keyId}) and set it active.`);

  const hasVisibleApps = identity.apps.length > 0;

  if (hasVisibleApps) {
    logger.line(`Visible apps: ${identity.apps.slice(0, 3).join(', ')}.`);
  }

  if (identity.teamId != null) {
    await offerSourceRemoval(p8Path, 'App Store Connect key', canPrompt);
  }
}

async function setAppleKey(commandOptions: CredentialsCommandOptions): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const p8Path = await selectAppleKeyFile(commandOptions, canPrompt);

  await importAppleKey(p8Path, commandOptions, canPrompt);
}

function isTextMissing(text: string | undefined): boolean {
  if (text == null) {
    return true;
  }

  return text.length == 0;
}

async function findConfiguredApp(
  apps: readonly AppDescriptor[],
  requestedApp: string,
): Promise<AppDescriptor> {
  for (const configuredApp of apps) {
    const isRequestedApp = configuredApp.name == requestedApp;

    if (isRequestedApp) {
      return configuredApp;
    }
  }

  failCommand('select app', `No configured app named "${requestedApp}".`);
}

async function selectConfiguredApp(
  apps: readonly AppDescriptor[],
  requestedApp: string | undefined,
  canPrompt: boolean,
): Promise<AppDescriptor> {
  if (requestedApp != null) {
    return findConfiguredApp(apps, requestedApp);
  }

  const onlyApp = apps[0];

  if (apps.length == 1) {
    if (onlyApp != null) {
      return onlyApp;
    }
  }

  if (canPrompt == false) {
    failCommand('select app', 'Pass --app <name>.');
  }

  if (apps.length == 0) {
    failCommand('select app', 'No applications were discovered.');
  }

  return LaunchPrompt.select({
    message: 'Choose an app:',
    choices: apps.map(function appChoice(configuredApp: AppDescriptor) {
      return { selection: configuredApp, label: configuredApp.name };
    }),
  });
}

async function setGoogleKey(
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const environment = readLaunchEnvironment();
  const canPrompt = commandCanPrompt(commandOptions);
  const enteredPath = await requireText(
    firstDefinedText(pathArgument, environment.values.playServiceAccountPath),
    'Path to the Play service-account JSON',
    'Pass the service-account JSON path or set PLAY_SERVICE_ACCOUNT.',
    canPrompt,
  );
  const keyPath = expandHomePath(enteredPath);
  const keyExists = await pathExists(keyPath);

  if (keyExists == false) {
    failCommand('import Google key', `No service-account JSON at ${enteredPath}.`);
  }

  const launchPaths = readLaunchDirectories();
  const loadedConfig = await loadConfig(launchPaths.workingDirectory);
  const app = await selectConfiguredApp(loadedConfig.apps, commandOptions.app, canPrompt);

  const packageName = app.packageName;

  if (packageName == null) {
    failCommand('import Google key', 'Set android.package for the selected app.');
  }

  if (packageName.length == 0) {
    failCommand('import Google key', 'Set android.package for the selected app.');
  }

  const serviceAccountJson = await readFile(keyPath, 'utf8');

  await storeServiceAccount(serviceAccountJson, packageName);
  createLogger(false).ok(`Stored the Play service account from ${displayPath(keyPath)}.`);
  await offerSourceRemoval(keyPath, 'Play service-account key', canPrompt);
}

async function chooseAccountInteractive(
  commandOptions: CredentialsCommandOptions = {},
): Promise<AccountRecord> {
  const accounts = await listAccounts();
  const activeKeyId = await getActiveKeyId();

  if (accounts.length == 0) {
    const p8Path = await selectAppleKeyFile(commandOptions, true);

    await importAppleKey(p8Path, commandOptions, true);

    const importedAccount = await getActiveAccount();

    if (importedAccount == null) {
      failCommand('choose Apple account', 'No active account after import.');
    }

    return importedAccount;
  }

  const chosenAccount = await LaunchPrompt.select({
    message: 'Choose an Apple account:',
    choices: accounts.map(function accountChoice(account: AccountRecord) {
      let accountLabel = account.label;
      const isActive = account.keyId == activeKeyId;

      if (isActive) {
        accountLabel = `${accountLabel} (active)`;
      }

      return {
        selection: account,
        label: accountLabel,
        hint: formatAccountSummary(account, { includeLabel: false }),
      };
    }),
  });

  await setActiveKeyId(chosenAccount.keyId);
  createLogger(false).ok(
    `Active Apple account: ${chosenAccount.label} (key ${chosenAccount.keyId}).`,
  );

  return chosenAccount;
}

async function selectAppleAccount(
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Promise<AccountRecord> {
  const environment = readLaunchEnvironment();
  const accounts = await listAccounts();
  const selector = firstDefinedText(commandOptions.account, environment.values.appleAccount);

  if (selector != null) {
    return requireMatchedAccount(accounts, selector, 'select Apple account');
  }

  const activeAccount = await getActiveAccount();

  if (activeAccount != null) {
    return activeAccount;
  }

  if (canPrompt == false) {
    failCommand(
      'select Apple account',
      'No active Apple account. Import one with `launch creds set-key`.',
    );
  }

  return chooseAccountInteractive(commandOptions);
}

async function setupIos(
  commandOptions: CredentialsCommandOptions,
  platform: Platform = 'ios',
): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const account = await selectAppleAccount(commandOptions, canPrompt);
  const ascKey = await loadAscKeyById(account.keyId);

  if (ascKey == null) {
    failCommand(
      'set up Apple signing',
      `Account "${account.label}" has no stored key. Re-import it with \`launch creds set-key\`.`,
    );
  }

  const launchPaths = readLaunchDirectories();
  const loadedConfig = await loadConfig(launchPaths.workingDirectory);
  const app = await selectConfiguredApp(loadedConfig.apps, commandOptions.app, canPrompt);

  if (app.bundleId == null) {
    failCommand(
      'set up Apple signing',
      `No Apple bundle identifier is configured for ${app.name}.`,
    );
  }

  const logger = createLogger(false);

  function confirmCreate(message: string): Promise<boolean> {
    if (canPrompt == false) {
      return Promise.resolve(true);
    }

    return LaunchPrompt.confirm(message);
  }

  const signingAssets = await ensureSigningCredentials({
    platform,
    bundleId: app.bundleId,
    appName: app.name,
    ascKey,
    log: logger,
    dryRun: false,
    confirmCreate,
  });

  logger.ok(
    `Ready (${account.label}): certificate ${signingAssets.certSerial}, profile ${signingAssets.profileName}.`,
  );
}

async function selectKeystoreImport(
  commandOptions: CredentialsCommandOptions,
  canPrompt: boolean,
): Promise<KeystoreImport | undefined> {
  if (commandOptions.import == null) {
    return undefined;
  }

  const importedPath = expandHomePath(commandOptions.import);
  const keystoreExists = await pathExists(importedPath);

  if (keystoreExists == false) {
    failCommand('import Android keystore', `No keystore at ${commandOptions.import}.`);
  }

  const environment = readLaunchEnvironment();
  const alias = await requireText(
    commandOptions.alias,
    'Key alias inside the keystore',
    'Pass --alias <alias>.',
    canPrompt,
  );
  const storePassword = await requireSecret(
    environment.values.androidKeystorePassword,
    'Keystore password',
    'Set ANDROID_KEYSTORE_PASSWORD.',
    canPrompt,
  );
  let keyPassword = storePassword;
  const androidKeyPassword = environment.values.androidKeyPassword;

  if (androidKeyPassword != null) {
    keyPassword = androidKeyPassword;
  }

  return { path: importedPath, alias, storePassword, keyPassword };
}

function provisionAndroidKeystore(
  options: Parameters<typeof ensureUploadKeystore>[0],
  keystoreImport: KeystoreImport | undefined,
): Promise<Awaited<ReturnType<typeof ensureUploadKeystore>>> {
  if (keystoreImport != null) {
    return ensureUploadKeystore({ ...options, import: keystoreImport });
  }

  return ensureUploadKeystore(options);
}

async function setupAndroid(commandOptions: CredentialsCommandOptions): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const launchPaths = readLaunchDirectories();
  const loadedConfig = await loadConfig(launchPaths.workingDirectory);
  const app = await selectConfiguredApp(loadedConfig.apps, commandOptions.app, canPrompt);
  const keystoreImport = await selectKeystoreImport(commandOptions, canPrompt);
  const logger = createLogger(false);

  const packageName = app.packageName;

  if (packageName == null) {
    failCommand('setup Android', 'Set android.package for the selected app.');
  }

  if (packageName.length == 0) {
    failCommand('setup Android', 'Set android.package for the selected app.');
  }

  function confirmCreate(message: string): Promise<boolean> {
    if (canPrompt == false) {
      return Promise.resolve(true);
    }

    return LaunchPrompt.confirm(message);
  }

  function confirmReplace(message: string): Promise<boolean> {
    if (commandOptions.yes == true) {
      return Promise.resolve(true);
    }

    if (canPrompt == false) {
      return Promise.resolve(false);
    }

    return LaunchPrompt.confirm(message);
  }

  const keystore = await provisionAndroidKeystore(
    {
      appName: app.name,
      packageName,
      log: logger,
      dryRun: false,
      confirmCreate,
      confirmReplace,
    },
    keystoreImport,
  );

  logger.ok(`Ready: upload keystore at ${displayPath(keystore.path)} (alias ${keystore.alias}).`);
}

async function verifyPlayAccess(serviceAccountJson: string, packageName: string): Promise<void> {
  const playClient = GoogleStoreClientService.createEffectClient(serviceAccountJson);

  await playClient.listTracks(packageName);
}

async function adoptAndroid(options: CredentialsCommandOptions): Promise<void> {
  if (options.app == null) {
    failCommand('adopt Android credentials', 'Pass --app <name>.');
  }

  const launchPaths = readLaunchDirectories();
  const configuration = await loadConfig(launchPaths.workingDirectory);
  const app = await selectConfiguredApp(configuration.apps, options.app, false);

  if (app.packageName == null) {
    failCommand('adopt Android credentials', 'Set android.package for the selected app.');
  }

  await adoptLegacyAndroidCredentials(app.packageName, options.yes == true, verifyPlayAccess);
  createLogger(false).ok(`Adopted legacy Android credentials for ${app.name}.`);
}

function isAndroidApp(app: AppDescriptor): boolean {
  return isTextMissing(app.packageName) == false;
}

async function listAndroidStatusApps(
  configuredApps: readonly AppDescriptor[],
  requestedApp: string | undefined,
): Promise<readonly AppDescriptor[]> {
  if (requestedApp == null) {
    return configuredApps.filter(isAndroidApp);
  }

  const selected = await selectConfiguredApp(configuredApps, requestedApp, false);

  if (selected.packageName == null) {
    return [];
  }

  return [selected];
}

async function showCredentialStatus(commandOptions: CredentialsCommandOptions): Promise<void> {
  const logger = createLogger(false);
  const accounts = await listAccounts();
  const activeKeyId = await getActiveKeyId();

  if (accounts.length == 0) {
    logger.line('Apple accounts: none');
  }

  for (const account of accounts) {
    const storedSigning = await describeStoredCredentials(account.keyId);
    let activeMarker = '';
    const isActiveAccount = account.keyId == activeKeyId;

    if (isActiveAccount) {
      activeMarker = ' (active)';
    }

    logger.line(`Apple account: ${formatAccountSummary(account)}${activeMarker}`);

    if (storedSigning.certSerial != null) {
      logger.line(`  certificate: ${storedSigning.certSerial}`);
    }

    const hasProfiles = storedSigning.bundleIds.length > 0;

    if (hasProfiles) {
      logger.line(`  profiles: ${storedSigning.bundleIds.join(', ')}`);
    }
  }

  const launchPaths = readLaunchDirectories();
  const configuredApps = (await loadConfig(launchPaths.workingDirectory)).apps;
  const androidApps = await listAndroidStatusApps(configuredApps, commandOptions.app);

  for (const app of androidApps) {
    if (app.packageName == null) {
      continue;
    }

    const androidCredentials = await describeStoredAndroidCredentials(app.packageName);
    let serviceAccountStatus = 'not stored';

    if (androidCredentials.hasServiceAccount) {
      serviceAccountStatus = 'stored';
    }

    logger.line(`Google service account (${app.name}): ${serviceAccountStatus}`);

    if (androidCredentials.keystoreAlias != null) {
      logger.line(
        `Android upload keystore (${app.name}): alias ${androidCredentials.keystoreAlias}`,
      );
    }
  }

  const pushKeys = await listPushKeys();

  logger.line(`APNs keys: ${pushKeys.length}`);
}

async function useAppleAccount(
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (selector == null) {
    const canPrompt = commandCanPrompt(commandOptions);

    if (canPrompt == false) {
      failCommand('use Apple account', 'Pass an account label or Key ID.');
    }

    await chooseAccountInteractive(commandOptions);

    return;
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector, 'use Apple account');

  await setActiveKeyId(matchedAccount.keyId);
  createLogger(false).ok(
    `Active Apple account: ${matchedAccount.label} (key ${matchedAccount.keyId}).`,
  );
}

async function renameAppleAccount(
  selector: string | undefined,
  enteredLabel: string | undefined,
): Promise<void> {
  if (selector == null) {
    failCommand('rename Apple account', 'Usage: launch creds rename <account> <new-label>.');
  }

  if (enteredLabel == null) {
    failCommand('rename Apple account', 'Usage: launch creds rename <account> <new-label>.');
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector, 'rename Apple account');
  const accountLabel = enteredLabel.trim();

  requireUniqueAccountLabel(accounts, accountLabel, matchedAccount.keyId, 'rename Apple account');
  await renameAccount(matchedAccount.keyId, accountLabel);
  createLogger(false).ok(`Renamed account ${matchedAccount.keyId} to "${accountLabel}".`);
}

const VENDOR_NUMBER_PATTERN = /^[0-9]+$/;

async function setAppleVendorNumber(commandOptions: CredentialsCommandOptions): Promise<void> {
  const usage = 'Usage: launch creds set-vendor-number --account <label> --vendor-number <n>.';
  const selector = commandOptions.account;
  const vendorNumber = commandOptions.vendorNumber;

  if (selector == null) {
    failCommand('set vendor number', usage);
  }

  if (vendorNumber == null) {
    failCommand('set vendor number', usage);
  }

  const trimmedVendorNumber = vendorNumber.trim();
  // A vendor number is digits only.
  const isVendorNumberDigits = VENDOR_NUMBER_PATTERN.test(trimmedVendorNumber);

  if (isVendorNumberDigits == false) {
    failCommand('set vendor number', 'The vendor number is digits only.');
  }

  const accounts = await listAccounts();
  const selectedAccount = requireMatchedAccount(accounts, selector, 'set vendor number');

  await setAccountVendorNumber(selectedAccount.keyId, trimmedVendorNumber);
  createLogger(false).ok(`Saved the vendor number for account "${selectedAccount.label}".`);
}

function isPortfolioFile(candidate: unknown): candidate is PortfolioFile {
  if (isRecord(candidate) == false) {
    return false;
  }

  if (candidate['version'] != 1) {
    return false;
  }

  if (Array.isArray(candidate['apps']) == false) {
    return false;
  }

  return Array.isArray(candidate['tags']);
}

async function readPortfolioDocument(): Promise<PortfolioFile | null> {
  return readDocumentFile(locatePortfolioFilePath(), function decodePortfolio(documentText) {
    const parsed: unknown = JSON.parse(documentText);

    if (isPortfolioFile(parsed)) {
      return parsed;
    }

    throw new Error('portfolio.json must be a portfolio file.');
  });
}

async function setPlayReportsBucket(commandOptions: CredentialsCommandOptions): Promise<void> {
  const usage = 'Usage: launch creds set-play-reports-bucket --play-reports-bucket <uri or name>.';
  const copiedBucket = commandOptions.playReportsBucket;

  if (copiedBucket == null) {
    failCommand('set Play reports bucket', usage);
  }

  const bucketName = parsePlayReportsBucket(copiedBucket);

  if (bucketName == null) {
    failCommand(
      'set Play reports bucket',
      'Expected a Cloud Storage URI like gs://pubsite_prod_rev_0123456789/ or its bucket name.',
    );
  }

  const savedFile = await readPortfolioDocument();
  const portfolioFile = pickSavedPortfolioFile(savedFile);

  await writeDocumentFileAtomically(locatePortfolioFilePath(), {
    ...portfolioFile,
    playReportsBucket: bucketName,
  });
  createLogger(false).ok(`Saved the Play reports bucket ${bucketName}.`);
}

async function removeAppleAccount(
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (selector == null) {
    failCommand('remove Apple account', 'Usage: launch creds remove <account>.');
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector, 'remove Apple account');
  const canPrompt = commandCanPrompt(commandOptions);

  if (canPrompt) {
    const confirmed = await LaunchPrompt.confirm(
      `Remove account "${matchedAccount.label}" and its signing assets?`,
    );

    if (confirmed == false) {
      return;
    }
  }

  await removeAccount(matchedAccount.keyId);
  createLogger(false).ok(`Removed Apple account "${matchedAccount.label}".`);
}

async function refreshOneAccount(account: AccountRecord, logger: Logger): Promise<void> {
  const ascKey = await loadAscKeyById(account.keyId);

  if (ascKey == null) {
    logger.warn(`Skipped "${account.label}": no stored key.`);

    return;
  }

  const identity = await AppStoreIdentityService.resolveIdentity(ascKey);

  await updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
  logger.ok(`Refreshed "${account.label}" (${identity.apps.length} apps).`);
}

async function refreshAppleAccounts(selector: string | undefined): Promise<void> {
  const accounts = await listAccounts();
  let refreshTargets = [...accounts];

  if (selector != null) {
    refreshTargets = [requireMatchedAccount(accounts, selector, 'refresh Apple accounts')];
  }

  if (refreshTargets.length == 0) {
    failCommand('refresh Apple accounts', 'No Apple accounts to refresh.');
  }

  const logger = createLogger(false);

  for (const account of refreshTargets) {
    await refreshOneAccount(account, logger);
  }
}

async function showPushKeys(): Promise<void> {
  const logger = createLogger(false);
  const pushKeys = await listPushKeys();

  if (pushKeys.length == 0) {
    logger.line('No APNs keys in the vault.');

    return;
  }

  for (const pushKey of pushKeys) {
    const details: string[] = [];
    const hasDistinctLabel = pushKey.label != null;

    if (hasDistinctLabel) {
      const labelDiffers = pushKey.label != pushKey.keyId;

      if (labelDiffers) {
        details.push(pushKey.label);
      }
    }

    if (pushKey.teamId != null) {
      details.push(`team ${pushKey.teamId}`);
    }

    let detailText = '';
    const hasDetails = details.length > 0;

    if (hasDetails) {
      detailText = ` - ${details.join(' - ')}`;
    }

    logger.line(`- ${pushKey.keyId}${detailText}`);
  }
}

function pickTeamId(
  commandTeamId: string | undefined,
  activeAccount: AccountRecord | null,
): string | undefined {
  if (commandTeamId != null) {
    return commandTeamId;
  }

  if (activeAccount == null) {
    return undefined;
  }

  return activeAccount.teamId;
}

async function importApnsKey(
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const enteredPath = await requireText(
    firstDefinedText(pathArgument, commandOptions.p8),
    'Path to the APNs .p8 key',
    'Pass the APNs .p8 path.',
    canPrompt,
  );
  const keyPath = expandHomePath(enteredPath);
  const keyExists = await pathExists(keyPath);

  if (keyExists == false) {
    failCommand('import APNs key', `No .p8 file at ${enteredPath}.`);
  }

  const filenameKeyId = extractKeyId(keyPath);
  let keyId = reconcileKeyId(commandOptions.keyId, filenameKeyId);

  keyId = await requireText(
    keyId,
    'APNs Key ID',
    'Pass --key-id <id> or name the file AuthKey_<KEYID>.p8.',
    canPrompt,
  );

  const activeAccount = await getActiveAccount();
  const teamId = pickTeamId(commandOptions.teamId, activeAccount);
  let keyLabel = commandOptions.label;

  if (keyLabel == null) {
    keyLabel = keyId;
  }

  const p8 = await readFile(keyPath, 'utf8');
  const importRequest: {
    keyId: string;
    p8: string;
    label: string;
    teamId?: string;
  } = { keyId, p8, label: keyLabel };

  if (teamId != null) {
    importRequest.teamId = teamId;
  }

  await importPushKey(importRequest);

  const logger = createLogger(false);

  logger.ok(`Imported APNs key ${keyId}.`);
  logger.warn(`Keep ${displayPath(keyPath)}; Apple permits only one download.`);
}

function blocksKeyOverwrite(outputExists: boolean, force: boolean | undefined): boolean {
  if (outputExists == false) {
    return false;
  }

  return force != true;
}

async function exportApnsKey(
  keyIdArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (keyIdArgument == null) {
    failCommand('export APNs key', 'Usage: launch creds push-key export <keyId> --out <path>.');
  }

  const keyRecord = await findPushKey(keyIdArgument);

  if (keyRecord == null) {
    failCommand('export APNs key', `No APNs key "${keyIdArgument}" exists.`);
  }

  const p8 = await loadPushKey(keyRecord.keyId);

  if (p8 == null) {
    failCommand('export APNs key', `APNs key ${keyRecord.keyId} has no stored secret.`);
  }

  const canPrompt = commandCanPrompt(commandOptions);
  const enteredPath = await requireText(
    commandOptions.out,
    'Write the APNs .p8 to',
    'Pass --out <path>.',
    canPrompt,
  );
  const outputPath = expandHomePath(enteredPath);
  const outputExists = await pathExists(outputPath);

  if (blocksKeyOverwrite(outputExists, commandOptions.force)) {
    failCommand(
      'export APNs key',
      `${displayPath(outputPath)} already exists. Pass --force to overwrite.`,
    );
  }

  if (canPrompt) {
    const confirmed = await LaunchPrompt.confirm(
      `Write secret APNs key ${keyRecord.keyId} to ${displayPath(outputPath)}?`,
    );

    if (confirmed == false) {
      return;
    }
  }

  const privateFileMode = 0o600;

  await writeFile(outputPath, p8, { mode: privateFileMode });
  createLogger(false).ok(`Wrote APNs key ${keyRecord.keyId} to ${displayPath(outputPath)}.`);
}

async function runPushKeyAction(
  pushAction: string | undefined,
  keyArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (pushAction == null) {
    await showPushKeys();

    return;
  }

  if (pushAction == 'status') {
    await showPushKeys();

    return;
  }

  if (pushAction == 'import') {
    await importApnsKey(keyArgument, commandOptions);

    return;
  }

  if (pushAction == 'export') {
    await exportApnsKey(keyArgument, commandOptions);

    return;
  }

  failCommand(
    'run APNs command',
    `Unknown push-key action "${pushAction}". Use import, status, or export.`,
  );
}

async function executeCredentialsCommand(decodedCommand: CredentialsCommandInput): Promise<void> {
  let platformText = decodedCommand.options.platform;

  if (platformText == null) {
    platformText = 'ios';
  }

  const platform = parsePlatform(platformText);

  if (decodedCommand.action == 'status') {
    await showCredentialStatus(decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'accounts') {
    await showCredentialStatus(decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'adopt') {
    if (platform != 'android') {
      failCommand('adopt credentials', 'Pass --platform android.');
    }

    await adoptAndroid(decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'set-key') {
    if (platform == 'android') {
      await setGoogleKey(decodedCommand.firstArgument, decodedCommand.options);

      return;
    }

    await setAppleKey(decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'setup') {
    if (platform == 'android') {
      await setupAndroid(decodedCommand.options);

      return;
    }

    await setupIos(decodedCommand.options, platform);

    return;
  }

  if (decodedCommand.action == 'use') {
    await useAppleAccount(decodedCommand.firstArgument, decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'rename') {
    await renameAppleAccount(decodedCommand.firstArgument, decodedCommand.secondArgument);

    return;
  }

  if (decodedCommand.action == 'remove') {
    await removeAppleAccount(decodedCommand.firstArgument, decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'logout') {
    await removeAppleAccount(decodedCommand.firstArgument, decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'refresh') {
    await refreshAppleAccounts(decodedCommand.firstArgument);

    return;
  }

  if (decodedCommand.action == 'set-vendor-number') {
    await setAppleVendorNumber(decodedCommand.options);

    return;
  }

  if (decodedCommand.action == 'set-play-reports-bucket') {
    await setPlayReportsBucket(decodedCommand.options);

    return;
  }

  await runPushKeyAction(
    decodedCommand.firstArgument,
    decodedCommand.secondArgument,
    decodedCommand.options,
  );
}

export async function credentialsCommandProgram(commandInput: unknown): Promise<void> {
  try {
    const decodedCommand = CredentialsCommandInputSchema(commandInput);

    await executeCredentialsCommand(decodedCommand);
  } catch (cause) {
    if (isCredentialsCommandFailure(cause)) {
      throw cause;
    }

    throw commandFailure('run credentials command', cause);
  }
}
