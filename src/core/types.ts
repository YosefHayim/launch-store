/**
 * Central domain types and the four provider interfaces that make Launch's
 * infrastructure pluggable.
 *
 * Everything Launch does flows through these shapes, so this file is the single
 * source of truth for the vocabulary: a build has a {@link ResolvedBuildContext},
 * it produces a {@link BuildArtifact} with a {@link SizeReport}, and each
 * swappable backend implements one of {@link CredentialsProvider},
 * {@link BuildEngine}, {@link StorageProvider}, or {@link Submitter}.
 */

/** Target mobile platform. iOS can only be built (signed) on macOS; Android builds on any OS. */
export type Platform = "ios" | "android";

/**
 * Where a submission lands, neutrally named and mapped to each store by the platform's submitter.
 * - `testing`: a testing track (iOS → TestFlight; Android → the chosen {@link PlayTrack}, default
 *   `internal`). The default, safe path.
 * - `production`: the store's public release queue (iOS App Store review / Android production track).
 *   Reached only by the deliberate `launch release` command.
 */
export type SubmitTarget = "testing" | "production";

/**
 * A Google Play release track. `internal` is the safe default: a new personal Play account must run
 * ~20 testers for 14 days on a testing track before production is unlocked, so defaulting anywhere
 * else would fail for fresh accounts. Has no iOS equivalent.
 */
export type PlayTrack = "internal" | "closed" | "open" | "production";

/**
 * Resolved Android release settings for one invocation, carried on {@link ResolvedBuildContext} so the
 * Google Play submitter reads a single source of truth. Resolved from `--track`/`--rollout`, then the
 * profile's defaults, then the safe fallback. Present only for Android builds; absent on iOS.
 */
export interface AndroidReleaseOptions {
  /** The Play track this build is assigned to. */
  track: PlayTrack;
  /** Staged-rollout fraction for a production release, 0–1 (`1` = full rollout). Ignored off production. */
  rollout: number;
}

/**
 * One app discovered in the surrounding monorepo.
 *
 * Launch auto-discovers these by scanning for `app.json`/`app.config` files, so the
 * facts here (bundle id, version) come straight from Expo's config and are never
 * duplicated in Launch's own config — `app.json` stays the single source of truth.
 */
export interface AppDescriptor {
  /** Short, unique handle used on the CLI (`launch build ios --app <name>`). Derived from the app slug. */
  name: string;
  /** Absolute path to the app's project directory (the folder containing its `app.json`). */
  dir: string;
  /** Absolute path to the discovered `app.json` / `app.config.*`. */
  configPath: string;
  /** iOS bundle identifier (`ios.bundleIdentifier`), e.g. `com.loopi.pomedero`. Undefined for Android-only apps. */
  bundleId?: string;
  /** Android application id (`android.package`), e.g. `com.loopi.pomedero`. Undefined for iOS-only apps. */
  packageName?: string;
  /** Human version string (`expo.version`), e.g. `1.0.0`. */
  version?: string;
  /**
   * Android `versionCode` floor from `app.json` (`android.versionCode`). The store's latest + 1 wins
   * when higher, so an intentional local bump is never clobbered but the store stays the source of truth.
   */
  androidVersionCode?: number;
}

/**
 * A named build profile from `launch.config.ts` (e.g. `production`, `preview`).
 *
 * Holds only Launch-specific settings; app facts stay in `app.json`. A profile maps to a
 * `.env` file whose values are injected into the build and gates the artifact on size.
 */
export interface BuildProfile {
  /** Profile name as referenced by `--profile`. */
  name: string;
  /** Dotenv file to load for this profile, relative to the app dir. Defaults to `.env`. */
  envFile?: string;
  /** Enable SSL pinning for this profile (mirrors the existing build.ts toggle). Defaults to false. */
  ssl?: boolean;
  /**
   * Per-device download-size budget in megabytes. When the size report exceeds it, the build
   * soft-gates (asks for confirmation) rather than failing. Defaults to 200 (Apple's cellular line).
   */
  sizeBudgetMB?: number;
  /**
   * Android-only: default Play track for `launch build android` when `--track` is omitted. Defaults
   * to `internal` (the only safe target for a fresh account). Ignored on iOS.
   */
  track?: PlayTrack;
  /**
   * Android-only: default staged-rollout fraction (0–1) for production releases when `--rollout` is
   * omitted. Defaults to `1.0` (full rollout). Ignored on iOS.
   */
  rollout?: number;
}

/**
 * The fully-resolved configuration for one `launch` invocation.
 *
 * Produced by {@link loadConfig} from `launch.config.ts` plus auto-discovered apps. Names here
 * (`storage`, `credentials`, `buildEngine`) are looked up in the provider registry at runtime.
 */
export interface LaunchConfig {
  /** Build profiles keyed by name. */
  profiles: Record<string, BuildProfile>;
  /** Registered name of the credentials provider to use. Defaults to `local` (serves both platforms). */
  credentials: string;
  /** Registered name of the artifact storage provider to use. Defaults to `local`. */
  storage: string;
  /**
   * Registered name of the build engine. Carries the iOS default `fastlane` (or `eas` for the cloud
   * handoff); an Android build swaps that iOS baseline for its twin `gradle` unless overridden here.
   */
  buildEngine: string;
  /**
   * Registered name of the submitter. Carries the iOS default `app-store-connect` (or `eas`); an
   * Android build swaps that iOS baseline for its twin `google-play` unless overridden here.
   */
  submit: string;
  /** Glob roots to scan for apps. Defaults to the repo root. */
  appRoots?: string[];
  /** AWS EC2 Mac settings for remote (off-Mac) builds. Only needed when building via `--remote aws`. */
  aws?: AwsConfig;
}

/**
 * Everything a single build needs, assembled before any work starts.
 *
 * This is the value threaded through the whole pipeline and into every provider, so a provider
 * never has to re-derive the app, profile, or environment.
 */
export interface ResolvedBuildContext {
  platform: Platform;
  app: AppDescriptor;
  profile: BuildProfile;
  /** Client-facing env vars (from the profile's `.env`) injected into the app at build time. */
  env: Record<string, string>;
  /** Whether to expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Rehearse the flow: print every step and the exact commands/requests, make no real changes. */
  dryRun: boolean;
  /**
   * Force a from-scratch (clean) build, set from `launch build --clean`. When false (the default) the
   * build engine decides clean-vs-incremental from the build fingerprint (see `core/buildFingerprint.ts`).
   */
  forceClean: boolean;
  /** Resolved Android track + rollout. Present only for Android builds; the submitter reads it. */
  android?: AndroidReleaseOptions;
  /**
   * Key ID of the Apple account resolved for this iOS run (from `--account`/`ASC_ACCOUNT`, the active
   * account, or the build-time picker). The `local` credentials provider loads this account's key and
   * signing assets. Absent on Android and on iOS dry-runs (which use the placeholder key).
   */
  account?: string;
}

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
 * private key is in the Keychain) plus the provisioning profile that ties it to one bundle id.
 * The pipeline hands this to the build engine, which feeds it straight into the export options.
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

/**
 * One row in a {@link SizeReport}: a device variant's estimated store download/install size.
 *
 * On iOS these come per-device from Xcode's App Thinning Size Report. On Android there is no thinning
 * report; `bundletool get-size` yields a single worst-case download, surfaced as one representative
 * row (`installBytes` left 0 — Play doesn't expose an honest install figure).
 */
export interface SizeReportEntry {
  /** Variant name, e.g. `iPhone15,2` (iOS) or `worst-case device` (Android bundletool estimate). */
  device: string;
  /** Estimated bytes the device downloads from the store (after iOS thinning / Android splits). */
  downloadBytes: number;
  /** Estimated bytes installed on the device. 0 when the platform gives no honest install figure. */
  installBytes: number;
}

/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a store round-trip discovering the app is too large.
 */
export interface SizeReport {
  /** Raw artifact file size on disk — the `.ipa` (iOS) or `.aab` (Android); NOT what users download. */
  artifactBytes: number;
  /** Per-device download/install estimates. Empty when no per-device report was produced. */
  entries: SizeReportEntry[];
}

/**
 * A built, signed artifact plus the metadata Launch records about it.
 *
 * Stored by a {@link StorageProvider} and used to build the run summary and the local index.
 */
export interface BuildArtifact {
  /** Absolute path to the signed `.ipa` (or `.aab`) on disk. */
  path: string;
  platform: Platform;
  appName: string;
  profile: string;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Unique, monotonically increasing build identifier — iOS `CFBundleVersion` or Android `versionCode`. */
  buildNumber: number;
  sizeReport: SizeReport;
  /**
   * Whether this artifact was compiled clean (from scratch) vs incrementally off warm caches. Read by
   * `launch release` to ask a second confirmation before promoting an incremental build to production —
   * the reproducibility guard, since release reuses this stored artifact rather than rebuilding.
   */
  clean: boolean;
  /** ISO-8601 creation timestamp, stamped by the caller (the pipeline). */
  createdAt: string;
}

/** A pointer to an artifact after a {@link StorageProvider} has stored it. */
export interface StoredArtifact {
  /** Stable identifier within the provider (e.g. a path or object key). */
  id: string;
  /** A URL or path a human can use to retrieve the artifact. */
  location: string;
}

/* -------------------------------------------------------------------------- */
/*  Provider interfaces — the "any infra, easily added" seam.                 */
/*  Implement one of these + register() to add a backend. Nothing else needs  */
/*  to change; the pipeline selects providers by name from LaunchConfig.       */
/* -------------------------------------------------------------------------- */

/**
 * Resolves and persists the credentials a build needs, for whichever platform the context names.
 *
 * The `local` implementation reads/writes the OS secret store and `~/.launch`, branching on
 * `ctx.platform` to return {@link AppleCredentials} (iOS) or {@link AndroidCredentials} (Android) as a
 * {@link BuildCredentials}. A future `team`/`s3` implementation could fetch shared, encrypted
 * credentials instead — the pipeline neither knows nor cares which backend answered.
 */
export interface CredentialsProvider {
  /** Registry name, e.g. `local`. */
  readonly name: string;
  /**
   * Resolve credentials for the given context: a cache hit returns immediately. iOS reuses-or-creates
   * the certificate + provisioning profile via the App Store Connect API; Android returns the
   * service-account key plus any cached upload keystore. The result is discriminated by `platform`.
   */
  resolve(ctx: ResolvedBuildContext): Promise<BuildCredentials>;
  /** Human-readable status of what's cached, across both platforms (used by `launch creds status`). */
  status(): Promise<string>;
}

/**
 * Compiles and signs the native project into a distributable artifact.
 *
 * `fastlane` runs `gym` → `.ipa` (iOS); `gradle` runs `bundleRelease` → `.aab` (Android). Each engine
 * narrows {@link BuildCredentials} to the platform it serves and rejects the other.
 */
export interface BuildEngine {
  /** Registry name, e.g. `fastlane` or `gradle`. */
  readonly name: string;
  /**
   * Archive, sign, export, and analyze size for the resolved build. `cleanBuilt` reports whether this
   * was a from-scratch compile (vs an incremental one reusing warm caches) so the pipeline can stamp
   * {@link BuildArtifact.clean} — which `launch release` reads to nudge before promoting an incremental.
   */
  build(
    ctx: ResolvedBuildContext,
    creds: BuildCredentials,
  ): Promise<{ artifactPath: string; sizeReport: SizeReport; cleanBuilt: boolean }>;
}

/**
 * Persists build artifacts and hands back a retrievable location.
 *
 * Shaped after the S3 object-store model (`put`/`get`/`list`/`url`) so cloud providers
 * (R2, S3, Supabase) are thin drop-ins. v1 ships only the `local` provider.
 */
export interface StorageProvider {
  /** Registry name, e.g. `local`. */
  readonly name: string;
  /** Store an artifact and return a pointer to it. */
  put(artifact: BuildArtifact): Promise<StoredArtifact>;
  /** List stored artifacts, newest first. */
  list(): Promise<BuildArtifact[]>;
  /** Resolve a retrievable location (path or URL) for a stored artifact id. */
  url(id: string): Promise<string>;
}

/**
 * Uploads a built artifact to a distribution destination.
 *
 * `app-store-connect` submits to TestFlight/App Store via fastlane `pilot`/`deliver`; `google-play`
 * submits to a Play track via fastlane `supply`. Each narrows {@link BuildCredentials} to its platform
 * and maps the neutral {@link SubmitTarget} onto its store's concept (Android also reads `ctx.android`).
 */
export interface Submitter {
  /** Registry name, e.g. `app-store-connect` or `google-play`. */
  readonly name: string;
  /** Upload `artifactPath` to `target`, authenticating with `creds`. */
  submit(artifactPath: string, target: SubmitTarget, creds: BuildCredentials, ctx: ResolvedBuildContext): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Remote / cloud-Mac build — the off-Mac path.                                */
/*  Two extra seams on top of the four above: a SecretStore (OS-native secret   */
/*  storage that also works on Windows/Linux) and a ComputeHost (provisions the */
/*  remote Mac). The remote build then drives the SAME fastlane spine over SSH. */
/* -------------------------------------------------------------------------- */

/**
 * The operating-system family Launch is running on.
 *
 * iOS code signing is macOS-only, so a `windows`/`linux` host cannot build locally — it must drive
 * a remote Mac (AWS EC2 Mac or a reachable Mac over SSH) or hand off to Expo EAS. The no-args wizard
 * branches on this value.
 */
export type HostOs = "macos" | "windows" | "linux";

/**
 * SSH connection parameters for reaching a remote Mac.
 *
 * Filled by a {@link ComputeHost}: `aws-ec2-mac` from a freshly-provisioned instance, `byo-ssh` from
 * a user-supplied `user@host` string. Consumed by the SSH transport helpers in `core/ssh.ts`.
 */
export interface SshTarget {
  /** Hostname or IP of the remote Mac. */
  host: string;
  /** SSH login user (EC2 Mac AMIs default to `ec2-user`). */
  user: string;
  /** SSH port. Defaults to 22. */
  port: number;
  /** Absolute path to the private key to authenticate with; omit to use the SSH agent / default key. */
  identityFile?: string;
}

/**
 * A handle to an allocated (or connected) remote Mac.
 *
 * Persisted to `~/.launch/cloud.json` so a later command can reuse the live paid-window host, show
 * accrued cost, and release it. For `byo-ssh` the AWS fields are absent — there is nothing to bill or
 * release; Launch only borrows the connection.
 */
export interface HostHandle {
  /** Registry name of the {@link ComputeHost} that owns this handle (e.g. `aws-ec2-mac`). */
  provider: string;
  /** SSH parameters to reach the host. */
  ssh: SshTarget;
  /** ISO-8601 instant the host was allocated — the 24h Apple-license billing clock starts here. */
  allocatedAt: string;
  /** EC2 instance id (`i-…`). Absent for `byo-ssh`. */
  instanceId?: string;
  /** EC2 Dedicated Host id (`h-…`) — the resource that bills until released. Absent for `byo-ssh`. */
  hostId?: string;
  /** AWS region the host lives in. Absent for `byo-ssh`. */
  region?: string;
  /** EC2 instance type (e.g. `mac2.metal`). Absent for `byo-ssh`. */
  instanceType?: string;
}

/**
 * A live host's status, for `launch cloud status` and the per-command cost banner.
 *
 * `estimatedCostUsd` is what has accrued so far under AWS's per-second billing; the real floor is
 * the 24h minimum (see `core/cost.ts`). `releasableAt` is when AWS first allows releasing the
 * Dedicated Host with no further commitment.
 */
export interface HostStatus {
  handle: HostHandle;
  /** Milliseconds since `allocatedAt`. */
  ageMs: number;
  /** Accrued cost so far in USD (informational; the 24h minimum is the real floor). */
  estimatedCostUsd: number;
  /** ISO-8601 instant the Dedicated Host can first be released (allocatedAt + 24h). */
  releasableAt: string;
}

/**
 * AWS settings for the EC2 Mac compute host, declared in `launch.config.ts` under `aws`.
 *
 * Launch stores NO AWS secrets: credentials resolve through the standard SDK chain (env → `~/.aws`
 * profiles → SSO → IMDS). `amiId` is an optional BYO golden image; omit it to let Launch bootstrap
 * one and persist its id to `~/.launch/cloud.json`.
 */
export interface AwsConfig {
  /** AWS region to allocate the Dedicated Host in (e.g. `us-east-1`). */
  region: string;
  /** Named profile in `~/.aws` to resolve via the credential chain. Omit to use the default chain. */
  profile?: string;
  /** BYO golden AMI id. Omit to bootstrap + snapshot one into your own account on first use. */
  amiId?: string;
  /** EC2 Mac instance type. Defaults to `mac2.metal` (cheapest M-series in most regions). */
  instanceType?: string;
}

/**
 * Where a remote build should run, resolved from `--remote [aws|user@host]` or the wizard.
 * - `aws`: provision an EC2 Mac via the `aws-ec2-mac` {@link ComputeHost}.
 * - `ssh`: connect to an already-reachable Mac via the `byo-ssh` {@link ComputeHost}.
 */
export type RemoteTarget = { kind: "aws" } | { kind: "ssh"; target: string };

/**
 * Request passed to {@link ComputeHost.allocate}.
 *
 * Carries everything a host backend needs to provision without depending on the logger or the
 * pipeline: AWS settings for `aws-ec2-mac`, an `user@host` string for `byo-ssh`, a consent gate for
 * the first billable action, and an optional progress sink. Reuse of a live host is handled by the
 * caller (`core/remotePipeline.ts`), so `allocate` always provisions fresh.
 */
export interface AllocateRequest {
  /** AWS settings (region/instanceType/amiId). Required by `aws-ec2-mac`, ignored by `byo-ssh`. */
  aws?: AwsConfig;
  /** `user@host[:port]` for `byo-ssh`. Ignored by `aws-ec2-mac`. */
  sshTarget?: string;
  /** Gate the first billable action; return false to abort allocation. */
  confirm(message: string): Promise<boolean>;
  /** Optional progress sink for long provisioning steps (booting, bootstrapping Xcode, snapshotting). */
  onProgress?: (message: string) => void;
}

/**
 * Generic OS-native secret storage — the cross-platform widening of the macOS-only Keychain.
 *
 * Backs the App Store Connect `.p8` and the distribution `.p12` password on whatever host Launch
 * runs on: macOS Keychain, Windows Credential Manager, or Linux libsecret. Non-Mac developers have
 * no Keychain; this seam gives them a real OS-native store. NOTE: importing a cert into a *codesign*
 * keychain (the `security import` calls) is a different concern and stays in `core/keychain.ts`.
 */
export interface SecretStore {
  /** Backend name, e.g. `macos-security` or `native-keyring`. */
  readonly name: string;
  /** Read a secret for `account`, or null if absent. */
  get(account: string): Promise<string | null>;
  /** Store (overwriting) a secret for `account`. */
  set(account: string, value: string): Promise<void>;
  /** Remove a stored secret for `account`. No-op if absent. */
  delete(account: string): Promise<void>;
}

/**
 * Provisions, connects to, and tears down a remote Mac for off-Mac iOS builds.
 *
 * `aws-ec2-mac` allocates a Dedicated Host + EC2 Mac instance (billing-aware, golden-AMI reuse);
 * `byo-ssh` simply wraps a Mac you already reach. `core/remotePipeline.ts` then drives the same
 * fastlane build/sign/submit spine over the SSH connection, so the host backend and the build logic
 * stay independent. SSH command execution lives in `core/ssh.ts`, shared by every host impl.
 */
export interface ComputeHost {
  /** Registry name, e.g. `aws-ec2-mac`. */
  readonly name: string;
  /** Provision a ready-to-SSH Mac (instance booted, toolchain present). Gated by {@link AllocateRequest.confirm}. */
  allocate(request: AllocateRequest): Promise<HostHandle>;
  /** Report a live host's age, accrued cost, and release time. Null if the handle is no longer live. */
  status(handle: HostHandle): Promise<HostStatus | null>;
  /** Release the host (AWS: terminate instance + release the Dedicated Host). No-op for `byo-ssh`. */
  teardown(handle: HostHandle): Promise<void>;
}
