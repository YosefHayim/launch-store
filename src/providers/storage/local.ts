// Stores build artifacts and distribution objects on the local filesystem.

import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { pathToFileURL } from 'node:url';
import { ArtifactRetention } from '@core/services/artifactRetention.js';
import { resolveArtifactsDirectory } from '@core/services/paths.js';
import type { BuildArtifact, PruneOptions } from '@core/types/artifacts.js';
import {
  makeProviderInputFailure,
  type StorageProvider,
  type StorageProviderResolver,
} from '@core/types/providers.js';

/** Acquire filesystem services once and return a leaf-like local storage provider. */
export const makeLocalStorageProvider = (directoryOverride?: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const artifactRetention = yield* ArtifactRetention;
    let baseDirectory = directoryOverride;
    if (baseDirectory === undefined) baseDirectory = yield* resolveArtifactsDirectory();
    const objectsDirectory = pathService.join(baseDirectory, 'objects');
    const artifactIndexPath = pathService.join(baseDirectory, 'index.json');
    const readIndex = () => artifactRetention.readIndex(artifactIndexPath);
    const writeIndex = (artifactIndex: BuildArtifact[]) =>
      artifactRetention.writeIndex(artifactIndex, artifactIndexPath);
    const objectPath = (objectKey: string): string =>
      pathService.join(objectsDirectory, ...objectKey.split('/'));

    const storageProvider: StorageProvider = {
      name: 'local',
      put: (artifact: BuildArtifact) =>
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(baseDirectory, { recursive: true });
          const artifactId = `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-${artifact.platform}${pathService.extname(artifact.path)}`;
          const destination = pathService.join(baseDirectory, artifactId);
          yield* fileSystem.copy(artifact.path, destination);
          const artifactIndex = yield* readIndex();
          artifactIndex.unshift({ ...artifact, path: destination });
          yield* writeIndex(artifactIndex);
          return { id: artifactId, location: destination };
        }),
      list: readIndex,
      prune: (pruneOptions: PruneOptions) =>
        artifactRetention.prune({ ...pruneOptions, indexPath: artifactIndexPath }),
      url: (artifactId: string) => {
        const artifactPath = pathService.join(baseDirectory, pathService.basename(artifactId));
        return fileSystem.exists(artifactPath).pipe(
          Effect.flatMap((artifactExists) => {
            if (artifactExists) return Effect.succeed(artifactPath);
            return Effect.fail(
              makeProviderInputFailure({
                provider: 'local-storage',
                message: `No stored artifact with id "${artifactId}".`,
              }),
            );
          }),
        );
      },
      putObject: (objectKey: string, objectContents: Buffer | string, _contentType: string) =>
        Effect.gen(function* () {
          const destination = objectPath(objectKey);
          yield* fileSystem.makeDirectory(pathService.dirname(destination), { recursive: true });
          if (typeof objectContents === 'string') {
            yield* fileSystem.writeFileString(destination, objectContents);
          } else {
            yield* fileSystem.writeFile(destination, objectContents);
          }
          return { id: objectKey, location: pathToFileURL(destination).href };
        }),
      getObject: (objectKey: string) => {
        const objectFilePath = objectPath(objectKey);
        return fileSystem.readFile(objectFilePath).pipe(
          Effect.map((fileBytes) => Buffer.from(fileBytes)),
          Effect.catchAll(() => Effect.succeed(null)),
        );
      },
      publicUrl: (objectKey: string): string => pathToFileURL(objectPath(objectKey)).href,
    };
    return storageProvider;
  });

type LocalStorageRequirements = Effect.Effect.Context<ReturnType<typeof makeLocalStorageProvider>>;

/** Capture shared services once and defer local-provider configuration until selection. */
export const makeLocalStorageProviderResolver = () =>
  Effect.gen(function* () {
    const providerServices = yield* Effect.context<LocalStorageRequirements>();
    return {
      name: 'local',
      resolveStorageProvider: (providerOptions) =>
        makeLocalStorageProvider(providerOptions.artifactDirectory).pipe(
          Effect.provide(providerServices),
        ),
    } satisfies StorageProviderResolver;
  });
