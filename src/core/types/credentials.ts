export type AscKey = {
  keyId: string;
  issuerId: string;
  p8: string;
};
/**
 * One imported APNs authentication key (`.p8`) in Launch's push-key vault (`~/.launch/push-keys.json`).
 *
 * An APNs auth key is how a backend sends push notifications to your app. Unlike the App Store Connect
 * key, Apple exposes NO API to create one - it's a download-once, portal-only key (Certificates, IDs &
 * Profiles -> Keys), capped at 2 per account - so Launch can only *import* and safeguard a key you've
 * already downloaded, never mint one. Launch never *uses* these keys (push is a backend/runtime concern);
 * the vault exists so a download-once secret isn't lost. This record is non-secret metadata only - the
 * `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`. An APNs key is team-wide, not per-app.
 */
export type ApnsKeyRecord = {
  keyId: string;
  teamId?: string;
  label?: string;
  importedAt: string;
};
/**
 * One onboarded Apple account in Launch's registry (`~/.launch/accounts.json`).
 *
 * An App Store Connect API key belongs to exactly one Apple team, so each registry entry *is* an
 * account: there is no separate team/provider to choose. This record holds only non-secret metadata
 * - the `.p8` private key itself stays in the OS secret store under `asc-p8:<keyId>`. `teamId` and
 * `apps` are resolved from Apple once at add-time and cached for an instant, offline-capable picker;
 * `resolvedAt` being absent means they were never fetched (e.g. the key was added while offline).
 */
export type AccountRecord = {
  keyId: string;
  issuerId: string;
  label: string;
  teamId?: string;
  apps?: string[];
  addedAt: string;
  resolvedAt?: string;
};
/**
 * The on-disk shape of `~/.launch/accounts.json`: the set of onboarded Apple accounts plus which one
 * is active. `active` is the Key ID a build uses when no `--account`/`ASC_ACCOUNT` override is given;
 * `null` means none is selected yet (a fresh install, or the active account was just removed).
 */
export type AccountsFile = {
  active: string | null;
  accounts: AccountRecord[];
};
/**
 * The signing assets a release build needs, resolved (reused or freshly created) before export.
 *
 * These map one-to-one onto Xcode's manual-signing inputs: a distribution certificate (whose
 * private key is in the Keychain) plus the provisioning profile that ties it to one bundle id. An app
 * with embedded app-extension targets also carries each extension's bundle-id -> profile-name pairing in
 * {@link SigningAssets.extensionProfiles}, since `xcodebuild` must be told the profile for every signed
 * bundle in the `.ipa`, not just the main app. The pipeline hands this to the build engine, which feeds
 * it straight into the export options.
 */
export type SigningAssets = {
  bundleId: string;
  teamId: string;
  certName: string;
  certSerial: string;
  profileName: string;
  profileUuid: string;
  profilePath: string;
  extensionProfiles?: Record<string, string>;
};
/**
 * Apple credentials resolved for a build.
 *
 * The secret material (`.p8`, `.p12`) lives in the macOS Keychain; this shape carries the
 * non-secret references plus the in-memory key bytes a build/submit step needs right now.
 * `signing` is absent for steps that only need the API key (e.g. submission, build-number lookup).
 */
export type AppleCredentials = {
  ascKey: AscKey;
  signing?: SigningAssets;
};
/**
 * The upload keystore Launch owns (or imported) to sign Android App Bundles - the Android twin of
 * {@link SigningAssets}.
 *
 * Under Play App Signing, Google holds the real *app signing key* and never reveals it; the developer
 * only ever signs uploads with this separate, recoverable *upload key*. The store/key passwords live
 * in the {@link SecretStore}, never beside the file; this shape carries the non-secret references plus
 * the in-memory passwords a `gradle`/`bundletool` step needs right now.
 */
export type KeystoreAssets = {
  path: string;
  alias: string;
  storePassword: string;
  keyPassword: string;
};
/**
 * Android credentials resolved for a build - the Android twin of {@link AppleCredentials}.
 *
 * The secret material (service-account JSON, keystore passwords) lives in the {@link SecretStore};
 * this shape carries the in-memory bytes/paths a build/submit step needs right now. `keystore` is
 * absent for steps that only need the Play API (e.g. submission, `versionCode` lookup).
 */
export type AndroidCredentials = {
  serviceAccountJson: string;
  keystore?: KeystoreAssets;
};

export type ServiceAccount = {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  privateKeyId?: string;
};
/**
 * Credentials for one build, discriminated by `platform` so a single pipeline + registry serve both
 * stores. Every provider interface ({@link CredentialsProvider}, {@link BuildEngine}, {@link Submitter})
 * speaks this union; each concrete provider narrows with `switch (creds.platform)` and rejects the
 * platform it doesn't serve. This discriminant is what lets the iOS and Android legs share the spine
 * with no `any` and no unchecked casts.
 */
export type BuildCredentials =
  | ({
      platform: 'ios';
    } & AppleCredentials)
  | ({
      platform: 'android';
    } & AndroidCredentials);
