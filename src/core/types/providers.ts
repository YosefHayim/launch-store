import { Data, type Effect } from 'effect';
import type { SubmitTarget } from './app.js';
import type {
  BuildArtifact,
  PruneOptions,
  PruneResult,
  SizeReport,
  StoredArtifact,
} from './artifacts.js';
import type { ResolvedBuildContext, StorageConfig } from './config.js';
import type { BuildCredentials } from './credentials.js';
import type {
  AllocateRequest,
  AwsConfig,
  CloudDoctorReport,
  HostHandle,
  HostStatus,
} from './remote.js';

export type ProviderInputFailure = Readonly<{
  readonly _tag: 'ProviderInputFailure';
  readonly provider: string;
  readonly message: string;
}>;

export const makeProviderInputFailure = Data.tagged<ProviderInputFailure>('ProviderInputFailure');
/**
 * Resolves and persists the credentials a build needs, for whichever platform the context names.
 *
 * The `local` implementation reads/writes the OS secret store and `~/.launch`, branching on
 * `buildContext.platform` to return {@link AppleCredentials} (iOS) or {@link AndroidCredentials}
 * (Android) as a {@link BuildCredentials}. A future `team`/`s3` implementation could fetch shared, encrypted
 * credentials instead - the pipeline neither knows nor cares which backend answered.
 */
export type CredentialsProvider = Readonly<{
  readonly name: string;
  resolveBuildCredentials(
    buildContext: ResolvedBuildContext,
  ): Effect.Effect<BuildCredentials, unknown>;
  status(): Effect.Effect<string, unknown>;
}>;
/**
 * Compiles and signs the native project into a distributable artifact.
 *
 * `fastlane` runs `gym` -> `.ipa` (iOS); `gradle` runs `bundleRelease` -> `.aab` (Android). Each engine
 * narrows {@link BuildCredentials} to the platform it serves and rejects the other.
 */
export type BuildEngine = Readonly<{
  readonly name: string;
  buildArtifact(
    buildContext: ResolvedBuildContext,
    buildCredentials: BuildCredentials,
  ): Effect.Effect<
    Readonly<{
      artifactPath: string;
      sizeReport: SizeReport;
      cleanBuilt: boolean;
    }>,
    unknown
  >;
}>;

/** Runs a hosted build service that owns its authentication, build number, and optional submission. */
export type HostedBuildProvider = Readonly<{
  readonly name: string;
  describeCli(): Effect.Effect<string, unknown>;
  authenticate(): Effect.Effect<string, unknown>;
  build(
    buildContext: ResolvedBuildContext,
    profileName: string,
  ): Effect.Effect<
    Readonly<{
      artifactPath: string;
      sizeReport: SizeReport;
      buildNumber: number;
    }>,
    unknown
  >;
  submit(
    buildContext: ResolvedBuildContext,
    artifactPath: string,
    profileName: string,
  ): Effect.Effect<void, unknown>;
}>;
/**
 * Persists build artifacts and hands back a retrievable location.
 *
 * Shaped after the S3 object-store model (`put`/`list`/`url` for build artifacts, plus
 * `putObject`/`publicUrl` for the raw files ad-hoc install links and OTA manifests need) so cloud
 * providers (R2, S3, Supabase) are thin drop-ins. `local` writes under `~/.launch`; the cloud
 * providers upload to the user's own bucket and serve from {@link StorageConfig.publicBaseUrl}.
 */
export type StorageProvider = Readonly<{
  readonly name: string;
  put(artifact: BuildArtifact): Effect.Effect<StoredArtifact, unknown>;
  list(): Effect.Effect<readonly BuildArtifact[], unknown>;
  url(id: string): Effect.Effect<string, unknown>;
  putObject(
    key: string,
    objectContents: Buffer | string,
    contentType: string,
  ): Effect.Effect<StoredArtifact, unknown>;
  getObject(key: string): Effect.Effect<Buffer | null, unknown>;
  publicUrl(key: string): string;
  prune?(options: PruneOptions): Effect.Effect<PruneResult, unknown>;
}>;

export type StorageProviderOptions = Readonly<{
  readonly artifactDirectory?: string;
  readonly storageConfig?: StorageConfig;
}>;

export type StorageProviderResolver = Readonly<{
  readonly name: string;
  readonly resolveStorageProvider: (
    providerOptions: StorageProviderOptions,
  ) => Effect.Effect<StorageProvider, unknown>;
}>;
/**
 * Uploads a built artifact to a distribution destination.
 *
 * `app-store-connect` submits to TestFlight/App Store via fastlane `pilot`/`deliver`; `google-play`
 * submits to a Play track via fastlane `supply`. Each narrows Readonly<{@link BuildCredentials}> to its platform
 * and maps the neutral Readonly<{@link SubmitTarget}> onto its store's concept (Android also reads
 * `buildContext.android`).
 */
export type Submitter = Readonly<{
  readonly name: string;
  submit(
    artifactPath: string,
    target: SubmitTarget,
    buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ): Effect.Effect<void, unknown>;
}>;
/**
 * Generic OS-native secret storage - the cross-platform widening of the macOS-only Keychain.
 *
 * Backs the App Store Connect `.p8` and the distribution `.p12` password on whatever host Launch
 * runs on: macOS Keychain, Windows Credential Manager, or Linux libsecret. Non-Mac developers have
 * no Keychain; this seam gives them a real OS-native store. NOTE: importing a cert into a *codesign*
 * keychain (the `security import` calls) is a different concern and stays in `core/keychain.ts`.
 */
export type SecretStore = Readonly<{
  readonly name: string;
  get(account: string): Effect.Effect<string | null, unknown>;
  set(account: string, secretText: string): Effect.Effect<void, unknown>;
  delete(account: string): Effect.Effect<void, unknown>;
}>;
/**
 * Provisions, connects to, and tears down a remote Mac for off-Mac iOS builds.
 *
 * `aws-ec2-mac` allocates a Dedicated Host + EC2 Mac instance (billing-aware, golden-AMI reuse);
 * `byo-ssh` simply wraps a Mac you already reach. `core/remotePipeline.ts` then drives the same
 * fastlane build/sign/submit spine over the SSH connection, so the host backend and the build logic
 * stay independent. SSH command execution lives in `core/ssh.ts`, shared by every host impl.
 */
export type ComputeHost = Readonly<{
  readonly name: string;
  allocate(request: AllocateRequest): Effect.Effect<HostHandle, unknown>;
  status(handle: HostHandle): Effect.Effect<HostStatus | null, unknown>;
  teardown(handle: HostHandle): Effect.Effect<void, unknown>;
  doctor?(awsConfiguration: AwsConfig): Effect.Effect<CloudDoctorReport, unknown>;
}>;
