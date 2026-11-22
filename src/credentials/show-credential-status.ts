import { loadConfig } from '../config/config.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { AppDescriptor } from '../types/app.ts';
import { formatAccountSummary, getActiveKeyId, listAccounts } from './accounts.ts';
import { describeStoredAndroidCredentials } from './android-keystore-assets.ts';
import { describeStoredCredentials } from './apple-signing-assets.ts';
import type { CredentialsCommandOptions } from './credentials-command-options.ts';
import { listPushKeys } from './push-key-store.ts';
import { selectConfiguredApp } from './select-configured-app.ts';

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

    const accountSummary = formatAccountSummary(account);
    logger.line(`Apple account: ${accountSummary}${activeMarker}`);

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
