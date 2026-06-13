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

/** Target mobile platform. iOS can only be built on macOS; Android is deferred to a later milestone. */
export type Platform = "ios" | "android";

/**
 * Where a submission lands.
 * - `testflight`: uploads for internal/external testing (the default, safe path).
 * - `appstore`: enters Apple's public review queue (deliberate `launch release --to-store` only).
 */
export type SubmitTarget = "testflight" | "appstore";

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
  /** iOS bundle identifier, e.g. `com.loopi.pomedero`. Undefined until prebuild config is read. */
  bundleId?: string;
  /** Human version string (`expo.version`), e.g. `1.0.0`. */
  version?: string;
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
  /** Registered name of the credentials provider to use. Defaults to `local`. */
  credentials: string;
  /** Registered name of the artifact storage provider to use. Defaults to `local`. */
  storage: string;
  /** Registered name of the build engine to use. `fastlane` (local) or `eas` (cloud handoff). */
  buildEngine: string;
  /** Registered name of the submitter to use. Defaults to `app-store-connect`; `eas` for the EAS path. */
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
}

/**
 * The App Store Connect API key — Launch's single Apple credential.
 *
 * Used for everything: minting JWTs, managing signing assets, and uploading builds. The `.p8`
 * private key lives in the macOS Keychain; this shape carries its in-memory bytes plus the two
 * non-secret identifiers Apple needs alongside it.
 */
export interface AscKey {
  /** The key's ID (e.g. `QS5924Q3MD`). */
  keyId: string;
  /** The issuer UUID for the account's API keys. */
  issuerId: string;
  /** PEM contents of the `.p8` private key. Held in memory only, never written to the repo. */
  p8: string;
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

/** Per-device entry in an {@link SizeReport}, taken from Xcode's App Thinning Size Report. */
export interface SizeReportEntry {
  /** Device variant name, e.g. `iPhone15,2`. */
  device: string;
  /** Estimated bytes the device downloads from the store (after app thinning). */
  downloadBytes: number;
  /** Estimated bytes installed on the device. */
  installBytes: number;
}

/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a TestFlight round-trip discovering the app is too large.
 */
export interface SizeReport {
  /** Raw `.ipa` file size on disk (a zip — not what users actually download). */
  ipaBytes: number;
  /** Per-device download/install estimates. Empty if no thinning report was produced. */
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
  /** Unique, monotonically increasing build number (Apple requirement). */
  buildNumber: number;
  sizeReport: SizeReport;
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
 * Resolves and persists the Apple credentials a build needs.
 *
 * The v1 `local` implementation reads/writes the macOS Keychain and `~/.launch`. A future
 * `team` or `s3` implementation could fetch shared, encrypted credentials instead — the
 * pipeline neither knows nor cares which backend answered.
 */
export interface CredentialsProvider {
  /** Registry name, e.g. `local`. */
  readonly name: string;
  /**
   * Resolve credentials for the given context: a cache hit returns immediately; a miss uses the
   * App Store Connect API to reuse-or-create the certificate and provisioning profile, then caches.
   */
  resolve(ctx: ResolvedBuildContext): Promise<AppleCredentials>;
  /** Human-readable status of what's cached (used by `launch creds status`). */
  status(): Promise<string>;
}

/**
 * Compiles and signs the native project into a distributable artifact.
 *
 * The v1 `fastlane` implementation runs `gym`; a later `xcodebuild` implementation could drive
 * Apple's tools directly behind the exact same call.
 */
export interface BuildEngine {
  /** Registry name, e.g. `fastlane`. */
  readonly name: string;
  /** Archive, sign, export, and analyze size for the resolved build. */
  build(ctx: ResolvedBuildContext, creds: AppleCredentials): Promise<{ artifactPath: string; sizeReport: SizeReport }>;
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
 * The v1 implementation submits to App Store Connect (TestFlight by default) via fastlane `pilot`.
 * A later Google Play submitter implements the same interface.
 */
export interface Submitter {
  /** Registry name, e.g. `app-store-connect`. */
  readonly name: string;
  /** Upload `artifactPath` to `target`, authenticating with `creds`. */
  submit(artifactPath: string, target: SubmitTarget, creds: AppleCredentials, ctx: ResolvedBuildContext): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Remote / cloud-Mac build — the off-Mac path (see docs/plan-aws-ec2-mac.md). */
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
