// Prints saved App Store Connect accounts, signing files, and Google Play credentials.

import { loadConfig } from '../config/config.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { AppDescriptor } from '../types/app.ts';
import { formatAccountSummary, getActiveKeyId, listAccounts } from './accounts.ts';
import { describeStoredAndroidCredentials } from './android-keystore-assets.ts';
import { describeStoredCredentials } from './apple-signing-assets.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { listPushKeys } from './push-key-store.ts';
import { selectConfiguredApp } from './select-configured-app.ts';
import { redactText } from '../services/platform/redact.ts';

function isTextMissing(text: string | undefined): boolean {
  if (text == null) {
    return true;
  }

  return text.length == 0;
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

export async function showCredentialStatus(
  commandOptions: CredentialsCommandOptions,
): Promise<void> {
  const accounts = await listAccounts();
  const activeKeyId = await getActiveKeyId();

  if (accounts.length == 0) {
    console.log(redactText('Apple accounts: none'));
  }

  for (const account of accounts) {
    const storedSigning = await describeStoredCredentials(account.keyId);
    let activeMarker = '';

    const isActiveAccount = account.keyId == activeKeyId;

    if (isActiveAccount) {
      activeMarker = ' (active)';
    }

    const accountSummary = formatAccountSummary(account);

    console.log(redactText(`Apple account: ${accountSummary}${activeMarker}`));

    if (storedSigning.certSerial != null) {
      console.log(redactText(`  certificate: ${storedSigning.certSerial}`));
    }

    const hasProfiles = storedSigning.bundleIds.length > 0;

    if (hasProfiles) {
      console.log(redactText(`  profiles: ${storedSigning.bundleIds.join(', ')}`));
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

    console.log(redactText(`Google service account (${app.name}): ${serviceAccountStatus}`));

    if (androidCredentials.keystoreAlias != null) {
      console.log(
        redactText(
          `Android upload keystore (${app.name}): alias ${androidCredentials.keystoreAlias}`,
        ),
      );
    }
  }

  const pushKeys = await listPushKeys();

  console.log(redactText(`APNs keys: ${pushKeys.length}`));
}
