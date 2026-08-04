// Resolves locally stored Apple and Android build credentials.

import { Data, Effect } from 'effect';
import {
  type AppleCredentialAccountStatus,
  LocalCredentialsStore,
} from '@core/services/localCredentialsStore.js';
import { isApplePlatform } from '@core/services/platform.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import type { CredentialsProvider } from '@core/types/providers.js';

export type MissingCredentialsFailure = Readonly<{
  readonly _tag: 'MissingCredentialsFailure';
  readonly platform: 'apple' | 'android';
  readonly message: string;
}>;

export const makeMissingCredentialsFailure = Data.tagged<MissingCredentialsFailure>(
  'MissingCredentialsFailure',
);

/** Resolve an Apple key and any reusable signing assets for one build. */
const resolveAppleCredentials = (
  buildContext: ResolvedBuildContext,
  credentialStore: typeof LocalCredentialsStore.Service,
) =>
  Effect.gen(function* () {
    const ascKey = yield* credentialStore.loadAppleKey(buildContext.account);
    if (ascKey === null) {
      return yield* Effect.fail(
        makeMissingCredentialsFailure({
          platform: 'apple',
          message: 'No App Store Connect API key found. Import one with: launch creds set-key',
        }),
      );
    }
    const appleCredentials: BuildCredentials = { platform: 'ios', ascKey };
    if (!buildContext.app.bundleId) return appleCredentials;
    const signingAssets = yield* credentialStore.loadAppleSigningAssets(
      ascKey.keyId,
      buildContext.app.bundleId,
      buildContext.app.iosExtensions,
    );
    if (signingAssets === null) return appleCredentials;
    return { ...appleCredentials, signing: signingAssets };
  });

/** Resolve a Play service account and any reusable upload keystore. */
const resolveAndroidCredentials = (credentialStore: typeof LocalCredentialsStore.Service) =>
  Effect.gen(function* () {
    const serviceAccountJson = yield* credentialStore.loadPlayServiceAccount();
    if (serviceAccountJson === null) {
      return yield* Effect.fail(
        makeMissingCredentialsFailure({
          platform: 'android',
          message:
            'No Play service account found. Import one with: launch creds set-key --platform android <key.json>',
        }),
      );
    }
    const androidCredentials: BuildCredentials = { platform: 'android', serviceAccountJson };
    const keystoreAssets = yield* credentialStore.loadAndroidKeystore();
    if (keystoreAssets === null) return androidCredentials;
    return { ...androidCredentials, keystore: keystoreAssets };
  });

const formatAppleAccountStatus = (accountStatus: AppleCredentialAccountStatus): string => {
  let marker = '';
  if (accountStatus.active) marker = ' <- active';
  let certificate = 'no cert';
  if (accountStatus.certificateSerial !== null) {
    certificate = `cert ${accountStatus.certificateSerial}`;
  }
  let profiles = 'no profiles';
  if (accountStatus.profileCount > 0) profiles = `${accountStatus.profileCount} profile(s)`;
  let unresolved = '';
  if (accountStatus.unresolved) unresolved = ' - unresolved - run `launch creds refresh`';
  return `  - ${accountStatus.label}${marker} - ${accountStatus.summary}${unresolved} - ${certificate} - ${profiles}`;
};

/** Render the Apple portion of the credential status report. */
const appleStatus = (credentialStore: typeof LocalCredentialsStore.Service) =>
  Effect.gen(function* () {
    const accountStatuses = yield* credentialStore.listAppleAccountStatuses();
    if (accountStatuses.length === 0) {
      return 'iOS: no Apple account imported (add one with `launch creds set-key`).';
    }
    const accountLines: string[] = [];
    for (const accountStatus of accountStatuses) {
      accountLines.push(formatAppleAccountStatus(accountStatus));
    }
    return [`iOS accounts (${accountStatuses.length}):`, ...accountLines].join('\n');
  });

/** Render the Android portion of the credential status report. */
const androidStatus = (credentialStore: typeof LocalCredentialsStore.Service) =>
  credentialStore.readAndroidCredentialStatus().pipe(
    Effect.map(({ keystoreAlias, hasServiceAccount }) => {
      if (!hasServiceAccount && !keystoreAlias) {
        return 'Android: no service account or upload keystore yet.';
      }
      let serviceAccount = 'no service account yet';
      if (hasServiceAccount) serviceAccount = 'service account present';
      let keystore = 'no upload keystore yet';
      if (keystoreAlias) keystore = `upload keystore (alias ${keystoreAlias})`;
      return `Android: ${serviceAccount}; ${keystore}.`;
    }),
  );

const statusReport = (credentialStore: typeof LocalCredentialsStore.Service) =>
  Effect.all([appleStatus(credentialStore), androidStatus(credentialStore)], {
    concurrency: 'unbounded',
  }).pipe(Effect.map((statusLines) => statusLines.join('\n')));

/** Acquire local services once and return a leaf-like provider for the registry. */
export const makeLocalCredentialsProvider = () =>
  Effect.gen(function* () {
    const credentialStore = yield* LocalCredentialsStore;
    return {
      name: 'local',
      resolveBuildCredentials: (buildContext): Effect.Effect<BuildCredentials, unknown> =>
        Effect.gen(function* () {
          if (isApplePlatform(buildContext.platform)) {
            return yield* resolveAppleCredentials(buildContext, credentialStore);
          }
          return yield* resolveAndroidCredentials(credentialStore);
        }),
      status: () => statusReport(credentialStore),
    } satisfies CredentialsProvider;
  });
