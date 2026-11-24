// Loads the Apple and Google signing material Launch keeps on this machine for a build.

import { LocalCredentialsStore } from '../../services/credentials/local-credentials-store.ts';
import { isApplePlatform } from '../../services/stores/platform.ts';
import type { BuildContext } from '../../types/config.ts';
import type { BuildCredentials } from '../../types/credentials.ts';
import type { CredentialsProvider } from '../../types/providers.ts';

type MissingCredentialsFailure = Readonly<{
  readonly _tag: 'MissingCredentialsFailure';
  readonly platform: 'apple' | 'android';
  readonly message: string;
}>;

type AppleAccountStatus = Awaited<
  ReturnType<LocalCredentialsStore['listAppleAccountStatuses']>
>[number];

type AndroidCredentialStatus = Awaited<
  ReturnType<LocalCredentialsStore['readAndroidCredentialStatus']>
>;

type CredentialsReader = Pick<
  LocalCredentialsStore,
  | 'loadAppleKey'
  | 'loadAppleSigningAssets'
  | 'describeMissingPlayServiceAccount'
  | 'loadPlayServiceAccount'
  | 'loadAndroidKeystore'
  | 'listAppleAccountStatuses'
  | 'readAndroidCredentialStatus'
>;

let credentialsReader: CredentialsReader | null = null;

export function useCredentialsReader(reader: CredentialsReader | null): void {
  credentialsReader = reader;
}

function readCredentials(): CredentialsReader {
  if (credentialsReader != null) {
    return credentialsReader;
  }

  return new LocalCredentialsStore();
}

function makeMissingCredentialsFailure(fields: {
  platform: 'apple' | 'android';
  message: string;
}): MissingCredentialsFailure {
  return { _tag: 'MissingCredentialsFailure', ...fields };
}

async function readAppleCredentials(
  buildContext: BuildContext,
  credentialStore: CredentialsReader,
): Promise<BuildCredentials> {
  const ascKey = await credentialStore.loadAppleKey(buildContext.account);

  if (ascKey == null) {
    throw makeMissingCredentialsFailure({
      platform: 'apple',
      message: 'No App Store Connect API key found. Import one with: launch-store creds set-key',
    });
  }

  const appleCredentials: BuildCredentials = { platform: 'ios', ascKey };
  const bundleId = buildContext.app.bundleId;

  const hasNoBundleId = bundleId == null;

  if (hasNoBundleId) {
    return appleCredentials;
  }

  const isBlankBundleId = bundleId == '';

  if (isBlankBundleId) {
    return appleCredentials;
  }

  const signingAssets = await credentialStore.loadAppleSigningAssets(
    ascKey.keyId,
    bundleId,
    buildContext.app.iosExtensions,
  );

  if (signingAssets == null) {
    return appleCredentials;
  }

  return { ...appleCredentials, signing: signingAssets };
}

async function readAndroidCredentials(
  credentialStore: CredentialsReader,
  buildContext: BuildContext,
): Promise<BuildCredentials> {
  const packageName = buildContext.app.packageName;

  if (packageName == null) {
    throw makeMissingCredentialsFailure({
      platform: 'android',
      message: 'Set android.package before resolving Android credentials.',
    });
  }

  const isBlankPackageName = packageName == '';

  if (isBlankPackageName) {
    throw makeMissingCredentialsFailure({
      platform: 'android',
      message: 'Set android.package before resolving Android credentials.',
    });
  }

  const serviceAccountJson = await credentialStore.loadPlayServiceAccount(packageName);

  if (serviceAccountJson == null) {
    const message = await credentialStore.describeMissingPlayServiceAccount(buildContext.app.name);

    throw makeMissingCredentialsFailure({
      platform: 'android',
      message,
    });
  }

  const androidCredentials: BuildCredentials = { platform: 'android', serviceAccountJson };
  const keystoreAssets = await credentialStore.loadAndroidKeystore(packageName);

  if (keystoreAssets == null) {
    return androidCredentials;
  }

  return { ...androidCredentials, keystore: keystoreAssets };
}

function formatAppleAccountStatus(accountStatus: AppleAccountStatus): string {
  let marker = '';

  if (accountStatus.active) {
    marker = ' <- active';
  }

  let certificate = 'no cert';

  if (accountStatus.certificateSerial != null) {
    certificate = `cert ${accountStatus.certificateSerial}`;
  }

  let profiles = 'no profiles';

  if (accountStatus.profileCount > 0) {
    profiles = `${accountStatus.profileCount} profile(s)`;
  }

  let unresolved = '';

  if (accountStatus.unresolved) {
    unresolved = ' - unresolved - run `launch-store creds refresh`';
  }

  return `  - ${accountStatus.label}${marker} - ${accountStatus.summary}${unresolved} - ${certificate} - ${profiles}`;
}

async function appleStatus(credentialStore: CredentialsReader): Promise<string> {
  const accountStatuses = await credentialStore.listAppleAccountStatuses();

  if (accountStatuses.length == 0) {
    return 'iOS: no Apple account imported (add one with `launch-store creds set-key`).';
  }

  const accountLines: string[] = [];

  for (const accountStatus of accountStatuses) {
    const appleAccountStatus = formatAppleAccountStatus(accountStatus);
    accountLines.push(appleAccountStatus);
  }

  return [`iOS accounts (${accountStatuses.length}):`, ...accountLines].join('\n');
}

function isAndroidCredentialEmpty(status: AndroidCredentialStatus): boolean {
  if (status.hasServiceAccount) {
    return false;
  }

  return status.keystoreAlias == null;
}

function describeAndroidCredentialStatus(status: AndroidCredentialStatus): string {
  if (isAndroidCredentialEmpty(status)) {
    return 'Android: no service account or upload keystore yet.';
  }

  let serviceAccount = 'no service account yet';

  if (status.hasServiceAccount) {
    serviceAccount = 'service account present';
  }

  let keystore = 'no upload keystore yet';

  if (status.keystoreAlias != null) {
    keystore = `upload keystore (alias ${status.keystoreAlias})`;
  }

  return `Android: ${serviceAccount}; ${keystore}.`;
}

async function androidStatus(
  credentialStore: CredentialsReader,
  packageName: string,
): Promise<string> {
  const status = await credentialStore.readAndroidCredentialStatus(packageName);

  return describeAndroidCredentialStatus(status);
}

async function statusReport(
  credentialStore: CredentialsReader,
  packageNames: readonly string[] = [],
): Promise<string> {
  const apple = await appleStatus(credentialStore);
  const androidLines: string[] = [];

  for (const packageName of packageNames) {
    const status = await androidStatus(credentialStore, packageName);
    androidLines.push(`${packageName}: ${status}`);
  }

  return [apple, ...androidLines].join('\n');
}

export function makeLocalCredentialsProvider(): CredentialsProvider {
  return {
    name: 'local',
    async readBuildCredentials(buildContext): Promise<BuildCredentials> {
      const credentialStore = readCredentials();

      const isApple = isApplePlatform(buildContext.platform);

      if (isApple) {
        return readAppleCredentials(buildContext, credentialStore);
      }

      return readAndroidCredentials(credentialStore, buildContext);
    },
    status(packageNames) {
      const credentials = readCredentials();
      return statusReport(credentials, packageNames);
    },
  };
}
