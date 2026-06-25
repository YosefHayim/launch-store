/**
 * The swappable provider interfaces — {@link CredentialsProvider} / {@link BuildEngine} /
 * {@link StorageProvider} / {@link Submitter} / {@link ComputeHost} — plus {@link SecretStore}. Implement
 * one as a named object and register it; the pipeline resolves it by name from `launch.config.ts`.
 */

import type { SubmitTarget } from "./app.js";
import type { BuildArtifact, PruneOptions, PruneResult, SizeReport, StoredArtifact } from "./artifacts.js";
import type { ResolvedBuildContext } from "./config.js";
import type { BuildCredentials } from "./credentials.js";
import type { AllocateRequest, HostHandle, HostStatus } from "./remote.js";

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
 * Shaped after the S3 object-store model (`put`/`list`/`url` for build artifacts, plus
 * `putObject`/`publicUrl` for the raw files ad-hoc install links and OTA manifests need) so cloud
 * providers (R2, S3, Supabase) are thin drop-ins. `local` writes under `~/.launch`; the cloud
 * providers upload to the user's own bucket and serve from {@link StorageConfig.publicBaseUrl}.
 */
export interface StorageProvider {
  /** Registry name, e.g. `local`, `s3`, `supabase`. */
  readonly name: string;
  /** Store a build artifact and return a pointer to it. */
  put(artifact: BuildArtifact): Promise<StoredArtifact>;
  /** List stored build artifacts, newest first. */
  list(): Promise<BuildArtifact[]>;
  /** Resolve a retrievable location (path or URL) for a stored artifact id. */
  url(id: string): Promise<string>;
  /**
   * Upload a raw object at `key` (a forward-slash path within the bucket) with the given content type,
   * returning its retrievable location. Powers ad-hoc distribution (IPA/APK + install plist + landing
   * page) and OTA updates (manifest JSON + JS bundles + assets), which store arbitrary keyed files.
   */
  putObject(key: string, body: Buffer | string, contentType: string): Promise<StoredArtifact>;
  /**
   * Read a raw object previously written with {@link putObject}, or `null` when the key is absent.
   * The read counterpart of {@link putObject}: powers the OTA update lifecycle (`updates list/view/
   * rollback`), which reads back the per-channel history index, the immutable manifest snapshots, and
   * the active rollback directive. Returns raw bytes so callers parse JSON or pass assets through as-is.
   */
  getObject(key: string): Promise<Buffer | null>;
  /**
   * The public URL an object at `key` is served from — computed without a network call so a manifest
   * can reference an asset's URL before that asset is uploaded (e.g. the install plist points at the
   * IPA's URL). For `local` this is a `file://` path (real install links need a cloud provider).
   */
  publicUrl(key: string): string;
  /**
   * Reclaim disk by deleting build binaries older than `retentionDays`, always keeping the newest per
   * app+platform (so a promotable artifact survives). **Local-only**: cloud providers leave this
   * undefined because their bucket lifecycle owns retention, and the pipeline's auto-sweep simply
   * no-ops for them. Keeps the index row (stamping {@link BuildArtifact.prunedAt}) so build history
   * survives the binary.
   */
  prune?(options: PruneOptions): Promise<PruneResult>;
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
