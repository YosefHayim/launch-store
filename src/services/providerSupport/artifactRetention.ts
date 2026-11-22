import {
  readArtifactIndex,
  runArtifactPrune,
  writeArtifactIndex,
} from '../../build/artifactRetention.js';
import type { BuildArtifact, PruneOptions, PruneResult } from '../../types/artifacts.js';

export const ArtifactRetention = {
  readIndex(indexPath: string): Promise<readonly BuildArtifact[]> {
    return readArtifactIndex(indexPath);
  },
  writeIndex(artifactIndex: readonly BuildArtifact[], indexPath: string): Promise<void> {
    return writeArtifactIndex(artifactIndex, indexPath);
  },
  prune(pruneOptions: PruneOptions & { readonly indexPath: string }): Promise<PruneResult> {
    return runArtifactPrune(pruneOptions);
  },
};

export type ArtifactRetentionService = typeof ArtifactRetention;
