// Creates or imports the Google Play upload keystore and service account for one app.

import { pathExists } from '../path-exists.ts';
import { loadConfig } from '../config/config.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { ensureUploadKeystore, type KeystoreImport } from './android-keystore-assets.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { failCommand } from './credentials-failure.ts';
import { displayPath, expandHomePath } from './credentials-paths.ts';
import { commandCanPrompt, requireText } from './credentials-prompt.ts';
import { selectConfiguredApp } from './select-configured-app.ts';

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

export async function setupAndroid(commandOptions: CredentialsCommandOptions): Promise<void> {
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
