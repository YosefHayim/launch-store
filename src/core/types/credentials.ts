/**
 * Apple & Android credentials, in two distinct flavours — read the per-shape docs before assuming what a
 * field holds:
 *
 * - **Resolved credentials** handed to a build/submit step ({@link AscKey}, {@link AppleCredentials},
 *   {@link KeystoreAssets}, {@link AndroidCredentials}, {@link BuildCredentials}) DO carry live secret
 *   material in memory — the `.p8` PEM, the keystore passwords, the service-account JSON — read out of the
 *   OS keychain / {@link SecretStore} just-in-time. These must never be logged, serialized, written to
 *   `~/.launch`, or committed; they exist only for the duration of the engine call that consumes them.
 * - **Persistence records** ({@link AccountRecord}, {@link ApnsKeyRecord}, {@link AccountsFile}) are the
 *   on-disk `~/.launch/*.json` shapes and carry only non-secret ids, paths, and metadata; the secret they
 *   reference stays in the OS secret store, namespaced by key id.
 *
 * {@link SigningAssets} sits between the two: non-secret references to a certificate/profile whose private
 * key never leaves the Keychain.
 */

/**
 * The App Store Connect API key — one Apple account's credential.
 *
 * Used for everything: minting JWTs, managing signing assets, and uploading builds. The `.p8`
 * private key lives in the OS secret store (namespaced per account by {@link AscKey.keyId}); this
 * shape carries its in-memory bytes plus the two non-secret identifiers Apple needs alongside it.
 * An API key belongs to exactly one Apple team, so the key *is* the account — see {@link AccountRecord}.
 */
export interface AscKey {
  /** The key's ID (e.g. `QS5924Q3MD`). Globally unique per Apple, so it doubles as the account key. */
  keyId: string;
  /** The issuer UUID for the account's API keys. */
  issuerId: string;
  /** PEM contents of the `.p8` private key. Held in memory only, never written to the repo. */
  p8: string;
}

/**
 * One imported APNs authentication key (`.p8`) in Launch's push-key vault (`~/.launch/push-keys.json`).
 *
 * An APNs auth key is how a backend sends push notifications to your app. Unlike the App Store Connect
 * key, Apple exposes NO API to create one — it's a download-once, portal-only key (Certificates, IDs &
 * Profiles → Keys), capped at 2 per account — so Launch can only *import* and safeguard a key you've
 * already downloaded, never mint one. Launch never *uses* these keys (push is a backend/runtime concern);
 * the vault exists so a download-once secret isn't lost. This record is non-secret metadata only — the
 * `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`. An APNs key is team-wide, not per-app.
 */
export interface ApnsKeyRecord {
  /** The key's ID — the 10-char value in the `AuthKey_<KEYID>.p8` filename. The vault's primary key. */
  keyId: string;
  /** Apple Team ID the key belongs to, when known (from the active account or `--team-id`). */
  teamId?: string;
  /** Human label chosen at import time (e.g. `Prod push`). Defaults to the Key ID. */
  label?: string;
  /** ISO-8601 instant the key was imported into the vault. */
  importedAt: string;
}

/**
 * One onboarded Apple account in Launch's registry (`~/.launch/accounts.json`).
 *
 * An App Store Connect API key belongs to exactly one Apple team, so each registry entry *is* an
 * account: there is no separate team/provider to choose. This record holds only non-secret metadata
 * — the `.p8` private key itself stays in the OS secret store under `asc-p8:<keyId>`. `teamId` and
 * `apps` are resolved from Apple once at add-time and cached for an instant, offline-capable picker;
 * `resolvedAt` being absent means they were never fetched (e.g. the key was added while offline).
 */
export interface AccountRecord {
  /** App Store Connect Key ID — the registry's primary key (globally unique per Apple). */
  keyId: string;
  /** Issuer UUID for this account's API keys. Non-secret; needed alongside the `.p8` to mint a JWT. */
  issuerId: string;
  /** Human label chosen at add-time, unique across accounts (e.g. `Personal`, `Acme client`). */
  label: string;
  /** Apple Team ID (the bundle-id `seedId`, e.g. `5NS9ZUMYCS`), resolved from Apple. Absent until resolved. */
  teamId?: string;
  /** Names of the apps this key can see, cached for recognizability in the picker. Absent until resolved. */
  apps?: string[];
  /** ISO-8601 instant the account was added to the registry. */
  addedAt: string;
  /** ISO-8601 instant `teamId`/`apps` were last fetched from Apple. Absent = never resolved. */
  resolvedAt?: string;
}

/**
 * The on-disk shape of `~/.launch/accounts.json`: the set of onboarded Apple accounts plus which one
 * is active. `active` is the Key ID a build uses when no `--account`/`ASC_ACCOUNT` override is given;
 * `null` means none is selected yet (a fresh install, or the active account was just removed).
 */
export interface AccountsFile {
  /** Key ID of the active account, or `null` when none is selected. */
  active: string | null;
  /** Every onboarded account, in insertion order. */
  accounts: AccountRecord[];
}

/**
 * The signing assets a release build needs, resolved (reused or freshly created) before export.
 *
 * These map one-to-one onto Xcode's manual-signing inputs: a distribution certificate (whose
 * private key is in the Keychain) plus the provisioning profile that ties it to one bundle id. An app
 * with embedded app-extension targets also carries each extension's bundle-id → profile-name pairing in
 * {@link SigningAssets.extensionProfiles}, since `xcodebuild` must be told the profile for every signed
 * bundle in the `.ipa`, not just the main app. The pipeline hands this to the build engine, which feeds
 * it straight into the export options.
 */
export interface SigningAssets {
  /** Bundle identifier these assets sign, e.g. `com.loopi.pomedero`. */
  bundleId: string;
  /** Apple Developer Team ID (e.g. `5NS9ZUMYCS`), read from the provisioning profile. */
  teamId: string;
  /** Codesign identity name to select, e.g. `Apple Distribution`. */
  certName: string;
  /** Serial number of the distribution certificate, used to detect/reuse a cached one. */
  certSerial: string;
  /** The provisioning profile's name as Apple stored it (matched in ExportOptions). */
  profileName: string;
  /** The profile's UUID — the filename Xcode looks for under `~/Library/MobileDevice`. */
  profileUuid: string;
  /** Absolute path to the installed `.mobileprovision` file. */
  profilePath: string;
  /**
   * Per-extension `bundleId → profileName` map for each embedded app-extension target, signed by the
   * same distribution certificate. Folded into the export-options `provisioningProfiles` dict alongside
   * the main bundle so `xcodebuild` signs every bundle in the `.ipa`. Absent / empty for an app with no
   * extension targets (the common case).
   */
  extensionProfiles?: Record<string, string>;
}

/**
 * Apple credentials resolved for a build.
 *
 * The secret material (`.p8`, `.p12`) lives in the macOS Keychain; this shape carries the
 * non-secret references plus the in-memory key bytes a build/submit step needs right now.
 * `signing` is absent for steps that only need the API key (e.g. submission, build-number lookup).
 */
export interface AppleCredentials {
  /** App Store Connect API key — Launch's single credential for managing creds and uploading. */
  ascKey: AscKey;
  /** Resolved distribution certificate + provisioning profile for code signing, when needed. */
  signing?: SigningAssets;
}

/**
 * The upload keystore Launch owns (or imported) to sign Android App Bundles — the Android twin of
 * {@link SigningAssets}.
 *
 * Under Play App Signing, Google holds the real *app signing key* and never reveals it; the developer
 * only ever signs uploads with this separate, recoverable *upload key*. The store/key passwords live
 * in the {@link SecretStore}, never beside the file; this shape carries the non-secret references plus
 * the in-memory passwords a `gradle`/`bundletool` step needs right now.
 */
export interface KeystoreAssets {
  /** Absolute path to the upload keystore (JKS/PKCS12), backed up under `~/.launch/credentials` (chmod 600). */
  path: string;
  /** Key alias inside the keystore, e.g. `upload`. */
  alias: string;
  /** Password unlocking the keystore file (from the {@link SecretStore}). */
  storePassword: string;
  /** Password unlocking the key entry (from the {@link SecretStore}; often equal to the store password). */
  keyPassword: string;
}

/**
 * Android credentials resolved for a build — the Android twin of {@link AppleCredentials}.
 *
 * The secret material (service-account JSON, keystore passwords) lives in the {@link SecretStore};
 * this shape carries the in-memory bytes/paths a build/submit step needs right now. `keystore` is
 * absent for steps that only need the Play API (e.g. submission, `versionCode` lookup).
 */
export interface AndroidCredentials {
  /** Play Developer API service-account key JSON — Launch's single Google credential (manage + read). */
  serviceAccountJson: string;
  /** Resolved upload keystore for signing the `.aab`, when needed. */
  keystore?: KeystoreAssets;
}

/**
 * Credentials for one build, discriminated by `platform` so a single pipeline + registry serve both
 * stores. Every provider interface ({@link CredentialsProvider}, {@link BuildEngine}, {@link Submitter})
 * speaks this union; each concrete provider narrows with `switch (creds.platform)` and rejects the
 * platform it doesn't serve. This discriminant is what lets the iOS and Android legs share the spine
 * with no `any` and no unchecked casts.
 */
export type BuildCredentials =
  | ({ platform: "ios" } & AppleCredentials)
  | ({ platform: "android" } & AndroidCredentials);
