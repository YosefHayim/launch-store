// Creates the App Store signing certificate and profiles for one configured app.

import { loadConfig } from '../config/config.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { Platform } from '../types/app.ts';
import type { AccountRecord } from '../types/credentials.ts';
import { getActiveAccount, listAccounts, loadAscKeyById } from './accounts.ts';
import { requireMatchedAccount } from './apple-account-match.ts';
import { ensureSigningCredentials } from './apple-signing-assets.ts';
import { chooseAccountInteractive } from './choose-account-interactive.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { failCommand } from './credentials-failure.ts';
import { commandCanPrompt, firstDefinedText } from './credentials-prompt.ts';
import { selectConfiguredApp } from './select-configured-app.ts';

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
      'No active Apple account. Import one with `launch-store creds set-key`.',
    );
  }

  return chooseAccountInteractive(commandOptions);
}

export async function setupIos(
  commandOptions: CredentialsCommandOptions,
  platform: Platform = 'ios',
): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const account = await selectAppleAccount(commandOptions, canPrompt);
  const ascKey = await loadAscKeyById(account.keyId);

  if (ascKey == null) {
    failCommand(
      'set up Apple signing',
      `Account "${account.label}" has no stored key. Re-import it with \`launch-store creds set-key\`.`,
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
