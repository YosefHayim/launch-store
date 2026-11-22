import { isAbsolute, join, resolve } from 'node:path';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { pathExists } from '../path-exists.ts';
import {
  getStorageProvider,
  getStorageProviderResolver,
} from '../services/provider-support/registry.ts';
import type { Platform } from '../types/app.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { LaunchConfig } from '../types/config.ts';
import { makeProviderInputFailure, type StorageProvider } from '../types/providers.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

type ArtifactDirectoryFailure = Readonly<{
  readonly _tag: 'ArtifactDirectoryFailure';
  readonly message: string;
}>;

type ArtifactUnavailableFailure = Readonly<{
  readonly _tag: 'ArtifactUnavailableFailure';
  readonly message: string;
  readonly artifactPath: string;
}>;

function makeArtifactDirectoryFailure(message: string): ArtifactDirectoryFailure {
  return { _tag: 'ArtifactDirectoryFailure', message };
}

function makeArtifactUnavailableFailure(fields: {
  message: string;
  artifactPath: string;
}): ArtifactUnavailableFailure {
  return {
    _tag: 'ArtifactUnavailableFailure',
    message: fields.message,
    artifactPath: fields.artifactPath,
  };
}

/**
 * Resolve `config.artifactDir` to the absolute base directory the `local` provider writes into.
 * Relative paths resolve against `projectRoot` (or the working directory); `~/` expands to home;
 * absolute paths are used as-is. Omitted -> `~/.launch/artifacts`. Empty string fails.
 */
export function resolveArtifactDir(artifactDir: string | undefined, projectRoot?: string): string {
  const launchPaths = readLaunchDirectories();
  let projectDirectory = launchPaths.workingDirectory;

  if (projectRoot != null) {
    projectDirectory = projectRoot;
  }

  if (artifactDir == null) {
    return join(launchPaths.homeDirectory, '.launch', 'artifacts');
  }

  const configuredDirectory = artifactDir.trim();

  if (configuredDirectory.length == 0) {
    throw makeArtifactDirectoryFailure(
      '`artifactDir` in launch.config.ts must not be empty - set a path or omit it for ~/.launch/artifacts.',
    );
  }

  if (configuredDirectory == '~') {
    return launchPaths.homeDirectory;
  }

  if (configuredDirectory.startsWith('~/')) {
    return resolve(launchPaths.homeDirectory, configuredDirectory.slice(2));
  }

  if (isAbsolute(configuredDirectory)) {
    return configuredDirectory;
  }

  return resolve(projectDirectory, configuredDirectory);
}

/**
 * Build (or look up) the storage provider named by `config.storage`, wiring `artifactDir` for
 * `local` and `storageConfig` for cloud backends.
 */
export async function resolveStorageProvider(
  config: LaunchConfig,
  projectRoot?: string,
): Promise<StorageProvider> {
  let providerResolver: ReturnType<typeof getStorageProviderResolver> | undefined;

  try {
    providerResolver = getStorageProviderResolver(config.storage);
  } catch (cause) {
    if (isFailureTag(cause, 'ProviderNotRegistered')) {
      providerResolver = undefined;
    } else {
      throw cause;
    }
  }

  if (providerResolver == null) {
    return getStorageProvider(config.storage);
  }

  if (config.storage == 'local') {
    return providerResolver.resolveStorageProvider({
      artifactDirectory: resolveArtifactDir(config.artifactDir, projectRoot),
    });
  }

  const isS3 = config.storage == 's3';
  const isSupabase = config.storage == 'supabase';
  const isCloudBackend = isS3 ? true : isSupabase;

  if (isCloudBackend) {
    const storageConfig = config.storageConfig;

    if (storageConfig == null) {
      throw makeProviderInputFailure({
        provider: config.storage,
        message: `Storage "${config.storage}" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).`,
      });
    }

    return providerResolver.resolveStorageProvider({ storageConfig });
  }

  if (config.storageConfig == null) {
    return providerResolver.resolveStorageProvider({});
  }

  return providerResolver.resolveStorageProvider({
    storageConfig: config.storageConfig,
  });
}

/**
 * Whether the resolved storage can serve public HTTP(S) URLs - required for ad-hoc install links
 * and OTA manifests. `local` is for build-artifact history only.
 */
export function isCloudStorage(config: LaunchConfig): boolean {
  return config.storage != 'local';
}

/**
 * Guard a promote/submit that reuses a stored binary. Turns a pruned or deleted binary into a
 * clear "rebuild first" precondition instead of an opaque store upload failure.
 */
export async function ensureArtifactPresent(
  artifact: BuildArtifact,
  appName: string,
  platform: Platform,
): Promise<void> {
  const isPruned = artifact.prunedAt != null;

  if (isPruned == false) {
    const artifactAvailable = await pathExists(artifact.path);

    if (artifactAvailable) {
      return;
    }
  }

  throw makeArtifactUnavailableFailure({
    artifactPath: artifact.path,
    message: `The latest stored ${appName} ${platform} build was pruned to reclaim disk. Run \`launch build ${platform}\` to rebuild before releasing.`,
  });
}
