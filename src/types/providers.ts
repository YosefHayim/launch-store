// Holds the swappable backends that sign, build, store, submit, and host a Launch run.

import type {
  BuildArtifact,
  PruneOptions,
  PruneResult,
  SizeReport,
  StoredArtifact,
} from './artifacts.ts';
import type { ResolvedBuildContext } from './config.ts';
import type { BuildCredentials } from './credentials.ts';
import type {
  AllocateRequest,
  AwsConfig,
  CloudDoctorReport,
  HostHandle,
  HostStatus,
} from './remote.ts';

export type ProviderInputFailure = Readonly<{
  readonly _tag: 'ProviderInputFailure';
  readonly provider: string;
  readonly message: string;
}>;

export function makeProviderInputFailure(fields: {
  provider: string;
  message: string;
}): ProviderInputFailure {
  return {
    _tag: 'ProviderInputFailure',
    provider: fields.provider,
    message: fields.message,
  };
}

/** A store refused an upload or never finished taking it; the message carries the store's own reasons. */
export type StoreUploadFailure = Readonly<{
  readonly _tag: 'StoreUploadFailure';
  readonly provider: string;
  readonly message: string;
}>;

export function makeStoreUploadFailure(fields: {
  provider: string;
  message: string;
}): StoreUploadFailure {
  return {
    _tag: 'StoreUploadFailure',
    provider: fields.provider,
    message: fields.message,
  };
}

/** Resolves and persists the credentials a build needs */
export type CredentialsProvider = Readonly<{
  readonly name: string;

  resolveBuildCredentials(buildContext: ResolvedBuildContext): Promise<BuildCredentials>;

  status(packageNames?: readonly string[]): Promise<string>;
}>;

/** Compiles and signs the native project into a distributable artifact. */
export type BuildEngine = Readonly<{
  readonly name: string;

  buildArtifact(
    buildContext: ResolvedBuildContext,
    buildCredentials: BuildCredentials,
  ): Promise<
    Readonly<{
      artifactPath: string;
      sizeReport: SizeReport;
      cleanBuilt: boolean;
    }>
  >;
}>;

/** Runs a hosted build service that owns its authentication, build number, and optional submission. */
export type HostedBuildProvider = Readonly<{
  readonly name: string;

  describeCli(): Promise<string>;

  authenticate(): Promise<string>;

  build(
    buildContext: ResolvedBuildContext,
    profileName: string,
  ): Promise<
    Readonly<{
      artifactPath: string;
      sizeReport: SizeReport;
      buildNumber: number;
    }>
  >;

  submit(
    buildContext: ResolvedBuildContext,
    artifactPath: string,
    profileName: string,
  ): Promise<void>;
}>;

/** Persists build artifacts and hands back a retrievable location. */
export type StorageProvider = Readonly<{
  readonly name: string;

  put(artifact: BuildArtifact): Promise<StoredArtifact>;

  list(): Promise<readonly BuildArtifact[]>;

  url(id: string): Promise<string>;

  putObject(
    key: string,
    objectContents: Buffer | string,
    contentType: string,
  ): Promise<StoredArtifact>;

  getObject(key: string): Promise<Buffer | null>;

  publicUrl(key: string): string;

  prune?(options: PruneOptions): Promise<PruneResult>;
}>;

export type StorageProviderOptions = Readonly<{
  readonly artifactDirectory?: string;
}>;

export type StorageProviderResolver = Readonly<{
  readonly name: string;
  readonly resolveStorageProvider: (
    providerOptions: StorageProviderOptions,
  ) => Promise<StorageProvider>;
}>;

/** The built binary a submitter uploads, with the version and build number stamped into it. */
export type SubmitArtifact = Pick<BuildArtifact, 'path' | 'version' | 'buildNumber'>;

/** Uploads a built artifact to a distribution destination. */
export type Submitter = Readonly<{
  readonly name: string;

  submit(
    artifact: SubmitArtifact,
    buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ): Promise<void>;
}>;

/** Generic OS-native secret storage - the cross-platform widening of the macOS-only Keychain. */
/** Provisions, connects to, and tears down a remote Mac for off-Mac iOS builds. */
export type ComputeHost = Readonly<{
  readonly name: string;

  allocate(request: AllocateRequest): Promise<HostHandle>;

  status(handle: HostHandle): Promise<HostStatus | null>;

  teardown(handle: HostHandle): Promise<void>;

  doctor?(awsConfiguration: AwsConfig): Promise<CloudDoctorReport>;
}>;
