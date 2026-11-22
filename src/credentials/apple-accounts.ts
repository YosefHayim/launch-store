import { loadConfig } from '../config/config.ts';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomic-document-file.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { locatePortfolioFilePath, readLaunchDirectories } from '../services/platform/paths.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { AppStoreIdentityService } from '../services/stores/app-store-identity.ts';
import { GoogleStoreClientService } from '../services/stores/google-store-client.ts';
import { pickSavedPortfolioFile } from '../portfolio/portfolio-store.ts';
import { parsePlayReportsBucket } from '../stats/play-reports-bucket.ts';
import type { AccountRecord } from '../types/credentials.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import {
  listAccounts,
  loadAscKeyById,
  removeAccount,
  renameAccount,
  setAccountVendorNumber,
  setActiveKeyId,
  updateAccountIdentity,
} from './accounts.ts';
import { adoptLegacyAndroidCredentials } from './android-keystore-assets.ts';
import { requireMatchedAccount, requireUniqueAccountLabel } from './apple-account-match.ts';
import { chooseAccountInteractive } from './choose-account-interactive.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { failCommand } from './credentials-failure.ts';
import { commandCanPrompt } from './credentials-prompt.ts';
import { selectConfiguredApp } from './select-configured-app.ts';

async function verifyPlayAccess(serviceAccountJson: string, packageName: string): Promise<void> {
  const playClient = GoogleStoreClientService.createEffectClient(serviceAccountJson);

  await playClient.listTracks(packageName);
}

export async function adoptAndroid(options: CredentialsCommandOptions): Promise<void> {
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

export async function useAppleAccount(
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

export async function renameAppleAccount(
  selector: string | undefined,
  enteredLabel: string | undefined,
): Promise<void> {
  if (selector == null) {
    failCommand('rename Apple account', 'Usage: launch-store creds rename <account> <new-label>.');
  }

  if (enteredLabel == null) {
    failCommand('rename Apple account', 'Usage: launch-store creds rename <account> <new-label>.');
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector, 'rename Apple account');
  const accountLabel = enteredLabel.trim();

  requireUniqueAccountLabel(accounts, accountLabel, matchedAccount.keyId, 'rename Apple account');
  await renameAccount(matchedAccount.keyId, accountLabel);
  createLogger(false).ok(`Renamed account ${matchedAccount.keyId} to "${accountLabel}".`);
}

export async function setAppleVendorNumber(
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const usage =
    'Usage: launch-store creds set-vendor-number --account <label> --vendor-number <n>.';
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
  const isVendorNumberDigits = /^[0-9]+$/.test(trimmedVendorNumber);

  if (isVendorNumberDigits == false) {
    failCommand('set vendor number', 'The vendor number is digits only.');
  }

  const accounts = await listAccounts();
  const selectedAccount = requireMatchedAccount(accounts, selector, 'set vendor number');

  await setAccountVendorNumber(selectedAccount.keyId, trimmedVendorNumber);
  createLogger(false).ok(`Saved the vendor number for account "${selectedAccount.label}".`);
}

function isPortfolioFile(candidate: unknown): candidate is PortfolioFile {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  if (candidateObject['version'] != 1) {
    return false;
  }

  if (Array.isArray(candidateObject['apps']) == false) {
    return false;
  }

  return Array.isArray(candidateObject['tags']);
}

async function readPortfolioDocument(): Promise<PortfolioFile | null> {
  const portfolioFilePath = locatePortfolioFilePath();
  return readDocumentFile(portfolioFilePath, function decodePortfolio(documentText) {
    const parsed: unknown = JSON.parse(documentText);

    if (isPortfolioFile(parsed)) {
      return parsed;
    }

    throw new Error('portfolio.json must be a portfolio file.');
  });
}

export async function setPlayReportsBucket(
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const usage =
    'Usage: launch-store creds set-play-reports-bucket --play-reports-bucket <uri or name>.';
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

  const portfolioFilePath = locatePortfolioFilePath();
  await writeDocumentFileAtomically(portfolioFilePath, {
    ...portfolioFile,
    playReportsBucket: bucketName,
  });
  createLogger(false).ok(`Saved the Play reports bucket ${bucketName}.`);
}

export async function removeAppleAccount(
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (selector == null) {
    failCommand('remove Apple account', 'Usage: launch-store creds remove <account>.');
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

export async function refreshAppleAccounts(selector: string | undefined): Promise<void> {
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
