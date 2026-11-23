// Runs a credentials action such as status, key import, account changes, or signing setup.

import { readFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { loadConfig } from '../config/config.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';
import { parsePlatform } from '../services/stores/platform.ts';
import { storeServiceAccount } from './android-keystore-assets.ts';
import {
  adoptAndroid,
  refreshAppleAccounts,
  removeAppleAccount,
  renameAppleAccount,
  setAppleVendorNumber,
  setPlayReportsBucket,
  useAppleAccount,
} from './apple-accounts.ts';
import { offerSourceRemoval } from './credential-discovery.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { commandFailure, failCommand } from './credentials-failure.ts';
import { displayPath, expandHomePath } from './credentials-paths.ts';
import { commandCanPrompt, firstDefinedText, requireText } from './credentials-prompt.ts';
import { runPushKeyAction } from './push-keys.ts';
import { selectConfiguredApp } from './select-configured-app.ts';
import { setAppleKey } from './set-apple-key.ts';
import { setupAndroid } from './setup-android.ts';
import { setupIos } from './setup-ios.ts';
import { showCredentialStatus } from './show-credential-status.ts';

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

const optionTextFields = [
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

type CredentialsCommandInput = {
  action: CredentialsAction;
  firstArgument?: string;
  secondArgument?: string;
  options: CredentialsCommandOptions;
};

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

  const asString = String(candidate);

  throw new Error(`Unknown credentials action "${asString}".`);
}

function readCommandOptions(record: Record<string, unknown>): CredentialsCommandOptions {
  const options: CredentialsCommandOptions = {};

  for (const fieldName of optionTextFields) {
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
  const commandInputObject = readPlainObject(commandInput);

  if (commandInputObject == null) {
    throw new Error('Credentials command input must be an object.');
  }

  const action = readAction(commandInputObject['action']);
  const optionsRecord = commandInputObject['options'];

  const optionsRecordObject = readPlainObject(optionsRecord);

  if (optionsRecordObject == null) {
    throw new Error('Credentials command options must be an object.');
  }

  let decoded: CredentialsCommandInput = {
    action,
    options: readCommandOptions(optionsRecordObject),
  };
  const firstArgument = readOptionalString(commandInputObject, 'firstArgument');
  const secondArgument = readOptionalString(commandInputObject, 'secondArgument');

  if (firstArgument != null) {
    decoded = { ...decoded, firstArgument };
  }

  if (secondArgument != null) {
    decoded = { ...decoded, secondArgument };
  }

  return decoded;
}

async function setGoogleKey(
  pathArgument: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const environment = readLaunchEnvironment();
  const canPrompt = commandCanPrompt(commandOptions);
  const firstDefined = firstDefinedText(pathArgument, environment.values.playServiceAccountPath);
  const enteredPath = await requireText(
    firstDefined,
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
    if (isFailureTag(cause, 'CredentialsCommandFailure')) {
      throw cause;
    }

    throw commandFailure('run credentials command', cause);
  }
}
