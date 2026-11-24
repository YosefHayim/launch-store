// Runs account changes for App Store Connect and adopts old Google Play credentials.

import { loadConfig } from '../config/config.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { AppStoreIdentityService } from '../services/stores/app-store-identity.ts';
import { GoogleStoreClientService } from '../services/stores/google-store-client.ts';
import type { AccountRecord } from '../types/credentials.ts';
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
import { commandCanPrompt } from './credentials-prompt.ts';
import { selectConfiguredApp } from './select-configured-app.ts';
import { redactText } from '../services/platform/redact.ts';

async function verifyPlayAccess(serviceAccountJson: string, packageName: string): Promise<void> {
  const playClient = new GoogleStoreClientService().createClient(serviceAccountJson);

  await playClient.listTracks(packageName);
}

export async function adoptAndroid(options: CredentialsCommandOptions): Promise<void> {
  if (options.app == null) {
    throw new Error('Pass --app <name>.');
  }

  const launchPaths = readLaunchDirectories();
  const configuration = await loadConfig(launchPaths.workingDirectory);
  const app = await selectConfiguredApp(configuration.apps, options.app, false);

  if (app.packageName == null) {
    throw new Error('Set android.package for the selected app.');
  }

  await adoptLegacyAndroidCredentials(app.packageName, options.yes == true, verifyPlayAccess);
  console.log(redactText(`Adopted legacy Android credentials for ${app.name}.`));
}

export async function useAppleAccount(
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (selector == null) {
    const canPrompt = commandCanPrompt(commandOptions);

    if (canPrompt == false) {
      throw new Error('Pass an account label or Key ID.');
    }

    await chooseAccountInteractive(commandOptions);

    return;
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector);

  await setActiveKeyId(matchedAccount.keyId);
  console.log(
    redactText(`Active Apple account: ${matchedAccount.label} (key ${matchedAccount.keyId}).`),
  );
}

export async function renameAppleAccount(
  selector: string | undefined,
  enteredLabel: string | undefined,
): Promise<void> {
  if (selector == null) {
    throw new Error('Usage: launch-store creds rename <account> <new-label>.');
  }

  if (enteredLabel == null) {
    throw new Error('Usage: launch-store creds rename <account> <new-label>.');
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector);
  const accountLabel = enteredLabel.trim();

  requireUniqueAccountLabel(accounts, accountLabel, matchedAccount.keyId);
  await renameAccount(matchedAccount.keyId, accountLabel);
  console.log(redactText(`Renamed account ${matchedAccount.keyId} to "${accountLabel}".`));
}

export async function setAppleVendorNumber(
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const usage =
    'Usage: launch-store creds set-vendor-number --account <label> --vendor-number <n>.';
  const selector = commandOptions.account;
  const vendorNumber = commandOptions.vendorNumber;

  if (selector == null) {
    throw new Error(usage);
  }

  if (vendorNumber == null) {
    throw new Error(usage);
  }

  const trimmedVendorNumber = vendorNumber.trim();
  // A vendor number is digits only.
  const isVendorNumberDigits = /^[0-9]+$/.test(trimmedVendorNumber);

  if (isVendorNumberDigits == false) {
    throw new Error('The vendor number is digits only.');
  }

  const accounts = await listAccounts();
  const selectedAccount = requireMatchedAccount(accounts, selector);

  await setAccountVendorNumber(selectedAccount.keyId, trimmedVendorNumber);
  console.log(redactText(`Saved the vendor number for account "${selectedAccount.label}".`));
}

export async function removeAppleAccount(
  selector: string | undefined,
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  if (selector == null) {
    throw new Error('Usage: launch-store creds remove <account>.');
  }

  const accounts = await listAccounts();
  const matchedAccount = requireMatchedAccount(accounts, selector);

  const canPrompt = commandCanPrompt(commandOptions);

  if (canPrompt) {
    const confirmed = await new LaunchPrompt().confirm(
      `Remove account "${matchedAccount.label}" and its signing assets?`,
    );

    if (confirmed == false) {
      return;
    }
  }

  await removeAccount(matchedAccount.keyId);
  console.log(redactText(`Removed Apple account "${matchedAccount.label}".`));
}

async function refreshOneAccount(account: AccountRecord): Promise<void> {
  const ascKey = await loadAscKeyById(account.keyId);

  if (ascKey == null) {
    console.log(redactText(`Skipped "${account.label}": no stored key.`));

    return;
  }

  const identity = await new AppStoreIdentityService().readIdentity(ascKey);

  await updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
  console.log(redactText(`Refreshed "${account.label}" (${identity.apps.length} apps).`));
}

export async function refreshAppleAccounts(selector: string | undefined): Promise<void> {
  const accounts = await listAccounts();
  let refreshTargets = [...accounts];

  if (selector != null) {
    refreshTargets = [requireMatchedAccount(accounts, selector)];
  }

  if (refreshTargets.length == 0) {
    throw new Error('No Apple accounts to refresh.');
  }
  for (const account of refreshTargets) {
    await refreshOneAccount(account);
  }
}
