import type { PlatformError } from '@effect/platform/Error';
import { Context, Effect, Layer } from 'effect';
import {
  type ArtifactIndexRequirements,
  readArtifactIndex,
  runArtifactPrune,
  writeArtifactIndex,
} from '../build/artifactRetention.js';
import type { BuildArtifact, PruneOptions, PruneResult } from '../types/artifacts.js';

/** Artifact-index persistence and retention operations used by storage providers. */
export type ArtifactRetentionService = Readonly<{
  readonly readIndex: (indexPath: string) => Effect.Effect<BuildArtifact[]>;
  readonly writeIndex: (
    artifactIndex: BuildArtifact[],
    indexPath: string,
  ) => Effect.Effect<void, PlatformError>;
  readonly prune: (
    pruneOptions: PruneOptions & { readonly indexPath: string },
  ) => Effect.Effect<PruneResult, PlatformError>;
}>;

export const ArtifactRetention = Context.GenericTag<ArtifactRetentionService>(
  'launch-store/ArtifactRetention',
);

/** Connect storage providers to the core artifact-retention program. */
export const ArtifactRetentionLive: Layer.Layer<
  ArtifactRetentionService,
  never,
  ArtifactIndexRequirements
> = Layer.effect(
  ArtifactRetention,
  Effect.gen(function* () {
    const artifactRetentionContext = yield* Effect.context<ArtifactIndexRequirements>();
    return {
      readIndex: (indexPath) =>
        readArtifactIndex(indexPath).pipe(Effect.provide(artifactRetentionContext)),
      writeIndex: (artifactIndex, indexPath) =>
        writeArtifactIndex(artifactIndex, indexPath).pipe(Effect.provide(artifactRetentionContext)),
      prune: (pruneOptions) =>
        runArtifactPrune(pruneOptions).pipe(Effect.provide(artifactRetentionContext)),
    } satisfies ArtifactRetentionService;
  }),
);
