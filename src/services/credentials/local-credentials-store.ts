// Reads saved Apple signing keys, profiles, and Google Play service accounts on this machine.

import {
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadActiveAscKey,
  loadAscKeyById,
} from '../../credentials/accounts.ts';
import {
  describeMissingPlayServiceAccount,
  describeStoredAndroidCredentials,
  loadCachedKeystore,
  loadServiceAccount,
} from '../../credentials/android-keystore-assets.ts';
import {
  describeStoredCredentials,
  loadCachedSigningAssets,
} from '../../credentials/apple-signing-assets.ts';
import type { AscKey, KeystoreAssets, SigningAssets } from '../../types/credentials.ts';

export type AppleCredentialAccountStatus = Readonly<{
  readonly keyId: string;
  readonly label: string;
  readonly summary: string;
  readonly active: boolean;
  readonly unresolved: boolean;
  readonly certificateSerial: string | null;
  readonly profileCount: number;
}>;

type AndroidCredentialStatus = Readonly<{
  readonly keystoreAlias: string | null;
  readonly hasServiceAccount: boolean;
}>;

function accountIsUnresolved(teamId: string | undefined, appCount: number): boolean {
  if (teamId == null) {
    return appCount == 0;
  }

  if (teamId.length == 0) {
    return appCount == 0;
  }

  return false;
}

function countApps(apps: readonly string[] | undefined): number {
  if (apps == null) {
    return 0;
  }

  return apps.length;
}

export class LocalCredentialsStore {
  async loadAppleKey(keyId?: string): Promise<AscKey | null> {
    if (keyId != null) {
      return loadAscKeyById(keyId);
    }

    return loadActiveAscKey();
  }

  loadAppleSigningAssets(
    keyId: string,
    bundleId: string,
    extensions?: readonly string[],
  ): Promise<SigningAssets | null> {
    return loadCachedSigningAssets(keyId, bundleId, extensions);
  }

  describeMissingPlayServiceAccount(appName: string): Promise<string> {
    return describeMissingPlayServiceAccount(appName);
  }

  loadPlayServiceAccount(packageName: string): Promise<string | null> {
    return loadServiceAccount(packageName);
  }

  loadAndroidKeystore(packageName: string): Promise<KeystoreAssets | null> {
    return loadCachedKeystore(packageName);
  }

  async listAppleAccountStatuses(): Promise<readonly AppleCredentialAccountStatus[]> {
    const appleAccounts = await listAccounts();
    const activeKeyId = await getActiveKeyId();
    const statuses: AppleCredentialAccountStatus[] = [];

    for (const appleAccount of appleAccounts) {
      const storedCredentials = await describeStoredCredentials(appleAccount.keyId);
      const accountSummary = formatAccountSummary(appleAccount, { includeLabel: false });

      statuses.push({
        keyId: appleAccount.keyId,
        label: appleAccount.label,
        summary: accountSummary,
        active: appleAccount.keyId == activeKeyId,
        unresolved: accountIsUnresolved(appleAccount.teamId, countApps(appleAccount.apps)),
        certificateSerial: storedCredentials.certSerial,
        profileCount: storedCredentials.bundleIds.length,
      });
    }

    return statuses;
  }

  readAndroidCredentialStatus(packageName: string): Promise<AndroidCredentialStatus> {
    return describeStoredAndroidCredentials(packageName);
  }
}
