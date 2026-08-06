import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import { type LaunchPathsService, LaunchPaths } from '../services/paths.js';
import { getStorageProvider, getStorageProviderResolver } from '../services/registry.js';
import type { Platform } from '../types/app.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { LaunchConfig } from '../types/config.js';
import { makeProviderInputFailure, type StorageProvider } from '../types/providers.js';

export type ArtifactDirectoryFailure = Readonly<{
  readonly _tag: 'ArtifactDirectoryFailure';
  readonly message: string;
}>;

export const makeArtifactDirectoryFailure = Data.tagged<ArtifactDirectoryFailure>(
  'ArtifactDirectoryFailure',
);

export type ArtifactUnavailableFailure = Readonly<{
  readonly _tag: 'ArtifactUnavailableFailure';
  readonly message: string;
  readonly artifactPath: string;
}>;

export const makeArtifactUnavailableFailure = Data.tagged<ArtifactUnavailableFailure>(
  'ArtifactUnavailableFailure',
);

/**
 * Resolve `config.artifactDir` to the absolute base directory the `local` provider writes into.
 * Relative paths resolve against `projectRoot` (or the working directory); `~/` expands to home;
 * absolute paths are used as-is. Omitted -> `~/.launch/artifacts`. Empty string fails.
 */
export const resolveArtifactDir = (
  artifactDir: string | undefined,
  projectRoot?: string,
): Effect.Effect<string, ArtifactDirectoryFailure, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    let projectDirectory = launchPaths.workingDirectory;
    if (projectRoot !== undefined) projectDirectory = projectRoot;
    if (artifactDir === undefined) {
      return pathService.join(launchPaths.homeDirectory, '.launch', 'artifacts');
    }
    const configuredDirectory = artifactDir.trim();
    if (configuredDirectory.length === 0) {
      return yield* Effect.fail(
        makeArtifactDirectoryFailure({
          message:
            '`artifactDir` in launch.config.ts must not be empty - set a path or omit it for ~/.launch/artifacts.',
        }),
      );
    }
    if (configuredDirectory === '~') return launchPaths.homeDirectory;
    if (configuredDirectory.startsWith('~/')) {
      return pathService.resolve(launchPaths.homeDirectory, configuredDirectory.slice(2));
    }
    if (pathService.isAbsolute(configuredDirectory)) return configuredDirectory;
    return pathService.resolve(projectDirectory, configuredDirectory);
  });

/**
 * Build (or look up) the storage provider named by `config.storage`, wiring `artifactDir` for
 * `local` and `storageConfig` for cloud backends.
 */
export const resolveStorageProvider = (
  config: LaunchConfig,
  projectRoot?: string,
): Effect.Effect<StorageProvider, unknown, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const providerResolver = yield* getStorageProviderResolver(config.storage).pipe(
      Effect.catchTag('ProviderNotRegistered', () => Effect.succeed(undefined)),
    );
    if (providerResolver === undefined) return yield* getStorageProvider(config.storage);

    switch (config.storage) {
      case 'local':
        return yield* providerResolver.resolveStorageProvider({
          artifactDirectory: yield* resolveArtifactDir(config.artifactDir, projectRoot),
        });
      case 's3':
      case 'supabase': {
        const storageConfig = config.storageConfig;
        if (storageConfig === undefined) {
          return yield* Effect.fail(
            makeProviderInputFailure({
              provider: config.storage,
              message: `Storage "${config.storage}" needs a storageConfig block in launch.config.ts (bucket + publicBaseUrl).`,
            }),
          );
        }
        return yield* providerResolver.resolveStorageProvider({ storageConfig });
      }
      default: {
        if (config.storageConfig === undefined) {
          return yield* providerResolver.resolveStorageProvider({});
        }
        return yield* providerResolver.resolveStorageProvider({
          storageConfig: config.storageConfig,
        });
      }
    }
  });

export type StorageResolverRequirements = Effect.Effect.Context<
  ReturnType<typeof resolveStorageProvider>
>;

/**
 * Whether the resolved storage can serve public HTTP(S) URLs - required for ad-hoc install links
 * and OTA manifests. `local` is for build-artifact history only.
 */
export const isCloudStorage = (config: LaunchConfig): boolean => config.storage !== 'local';

/**
 * Guard a promote/submit that reuses a stored binary. Turns a pruned or deleted binary into a
 * clear "rebuild first" precondition instead of an opaque store upload failure.
 */
export const ensureArtifactPresent = (
  artifact: BuildArtifact,
  appName: string,
  platform: Platform,
): Effect.Effect<void, ArtifactUnavailableFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    let artifactAvailable = artifact.prunedAt === undefined;
    if (artifactAvailable) {
      artifactAvailable = yield* fileSystem
        .exists(artifact.path)
        .pipe(Effect.orElseSucceed(() => false));
    }
    if (artifactAvailable) return;
    return yield* Effect.fail(
      makeArtifactUnavailableFailure({
        artifactPath: artifact.path,
        message: `The latest stored ${appName} ${platform} build was pruned to reclaim disk. Run \`launch build ${platform}\` to rebuild before releasing.`,
      }),
    );
  });
