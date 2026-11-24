// Finds where Launch keeps build files and whether testers can download them.

import { isAbsolute, join, resolve } from 'node:path';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { pathExists } from '../path-exists.ts';
import {
  getStorageProvider,
  getStorageProviderReader,
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

/** Read `config.artifactDir` to the absolute base directory the `local` provider writes into. */
export function readArtifactDir(artifactDir: string | undefined, projectRoot?: string): string {
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

/** Build (or look up) the storage provider named by `config.storage` */
export async function readStorageProvider(
  config: LaunchConfig,
  projectRoot?: string,
): Promise<StorageProvider> {
  let providerReader: ReturnType<typeof getStorageProviderReader> | undefined;

  try {
    providerReader = getStorageProviderReader(config.storage);
  } catch (cause) {
    if (isFailureTag(cause, 'ProviderNotRegistered')) {
      providerReader = undefined;
    } else {
      throw cause;
    }
  }

  const isLocal = config.storage == 'local';

  if (isLocal == false) {
    throw makeProviderInputFailure({
      provider: config.storage,
      message: 'Only local artifact storage is available.',
    });
  }

  if (providerReader == null) {
    return getStorageProvider(config.storage);
  }

  return providerReader.readStorageProvider({
    artifactDirectory: readArtifactDir(config.artifactDir, projectRoot),
  });
}

/** Whether the resolved storage can serve public HTTP(S) URLs */
export function isCloudStorage(config: LaunchConfig): boolean {
  return config.storage != 'local';
}

/** Guard a promote/submit that reuses a stored binary. */
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
    message: `The latest stored ${appName} ${platform} build was pruned to reclaim disk. Run \`launch-store build ${platform}\` to rebuild before releasing.`,
  });
}
