// Finds an App Store Connect private key and saves it as an account.

import { readFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import {
  AppStoreIdentityService,
  type AppStoreIdentity,
} from '../services/stores/app-store-identity.ts';
import type { AscKey } from '../types/credentials.ts';
import { addAccount, listAccounts } from './accounts.ts';
import { requireUniqueAccountLabel } from './apple-account-match.ts';
import { credentialSearchDirectories, offerSourceRemoval } from './credential-discovery.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { failCommand } from './credentials-failure.ts';
import { displayPath, expandHomePath } from './credentials-paths.ts';
import { commandCanPrompt, firstDefinedText, requireText } from './credentials-prompt.ts';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from './key-files.ts';

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

  return new LaunchPrompt().select({
    message: 'Multiple API keys found. Pick one:',
    choices,
  });
}

export async function selectAppleKeyFile(
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
      accountLabel = await new LaunchPrompt().requiredText('Label for this Apple account');
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
    return await new AppStoreIdentityService().verifyCredentials(ascKey);
  } catch (cause) {
    const status = readFailureStatus(cause);

    if (isRejectedAppleStatus(status)) {
      failCommand(
        'verify Apple key',
        'Apple rejected the key. Check that the Key ID, Issuer ID, and .p8 belong together.',
      );
    }

    const failureMessage = errorMessage(cause);

    logger.warn(
      `Could not verify the key with Apple (${failureMessage}). Saving it unresolved; run \`launch-store creds refresh\` later.`,
    );

    return { teamId: null, apps: [] };
  }
}

export async function importAppleKey(
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

  const firstDefined = firstDefinedText(commandOptions.issuerId, environment.values.appleIssuerId);
  const issuerId = await requireText(
    firstDefined,
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

export async function setAppleKey(commandOptions: CredentialsCommandOptions): Promise<void> {
  const canPrompt = commandCanPrompt(commandOptions);
  const p8Path = await selectAppleKeyFile(commandOptions, canPrompt);

  await importAppleKey(p8Path, commandOptions, canPrompt);
}
