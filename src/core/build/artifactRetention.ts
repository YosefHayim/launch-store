import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect, Option, Schema } from 'effect';
import { resolveArtifactIndexFilePath, type LaunchPathsService } from '../services/paths.js';
import type {
  BuildArtifact,
  PruneOptions,
  PruneResult,
  PrunedArtifact,
} from '../types/artifacts.js';
import { ArtifactIndexSchema } from '../types/artifacts.js';
import type { LaunchConfig } from '../types/config.js';

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ArtifactIndexRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

const resolveArtifactIndexPath = (
  indexPath: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> => {
  if (indexPath !== undefined) return Effect.succeed(indexPath);
  return resolveArtifactIndexFilePath();
};

/** Read and decode the newest-first artifact index; absent or malformed state yields []. */
export const readArtifactIndex = (
  indexPath?: string,
): Effect.Effect<BuildArtifact[], never, ArtifactIndexRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const artifactIndexPath = yield* resolveArtifactIndexPath(indexPath);
    if (!(yield* fileSystem.exists(artifactIndexPath))) return [];
    const artifactIndexSource = yield* fileSystem
      .readFileString(artifactIndexPath)
      .pipe(Effect.option);
    if (Option.isNone(artifactIndexSource)) return [];
    const decodedArtifactIndex = yield* Schema.decodeUnknown(Schema.parseJson(ArtifactIndexSchema))(
      artifactIndexSource.value,
    ).pipe(Effect.option);
    if (Option.isNone(decodedArtifactIndex)) return [];
    return decodedArtifactIndex.value;
  }).pipe(Effect.catchAll(() => Effect.succeed([])));

/** Persist the artifact index, creating its parent directory first. */
export const writeArtifactIndex = (
  artifactIndex: BuildArtifact[],
  indexPath?: string,
): Effect.Effect<void, PlatformError, ArtifactIndexRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const artifactIndexPath = yield* resolveArtifactIndexPath(indexPath);
    yield* fileSystem.makeDirectory(pathService.dirname(artifactIndexPath), { recursive: true });
    yield* fileSystem.writeFileString(artifactIndexPath, JSON.stringify(artifactIndex, null, 2));
  });

/** Automatic post-store retention window from config (default 30; 0 disables). */
export const resolveRetentionDays = (launchConfig: LaunchConfig): number => {
  if (launchConfig.artifactRetentionDays === undefined) return DEFAULT_RETENTION_DAYS;
  return launchConfig.artifactRetentionDays;
};

/**
 * Explicit `builds prune` window: CLI override wins; config when positive; default when unset or 0
 * so an explicit prune still does work when auto-sweep is disabled.
 */
export const resolveCommandRetentionDays = (
  launchConfig: LaunchConfig,
  retentionDaysOverride?: number,
): number => {
  if (retentionDaysOverride !== undefined) return retentionDaysOverride;
  const configuredRetentionDays = launchConfig.artifactRetentionDays;
  if (configuredRetentionDays === undefined) return DEFAULT_RETENTION_DAYS;
  if (configuredRetentionDays > 0) return configuredRetentionDays;
  return DEFAULT_RETENTION_DAYS;
};

const artifactAgeDays = (buildArtifact: BuildArtifact, currentTime: number): number | null => {
  const createdTime = Date.parse(buildArtifact.createdAt);
  if (Number.isNaN(createdTime)) return null;
  return (currentTime - createdTime) / DAY_MS;
};

const artifactGroupKey = (buildArtifact: BuildArtifact): string =>
  `${buildArtifact.appName}:${buildArtifact.platform}`;

/** Newest artifact per app+platform group (by createdAt). */
const newestArtifactByGroup = (artifactIndex: BuildArtifact[]): Map<string, BuildArtifact> => {
  const newestByGroup = new Map<string, BuildArtifact>();
  for (const buildArtifact of artifactIndex) {
    const groupKey = artifactGroupKey(buildArtifact);
    const currentNewest = newestByGroup.get(groupKey);
    if (currentNewest === undefined) {
      newestByGroup.set(groupKey, buildArtifact);
      continue;
    }
    const candidateCreated = Date.parse(buildArtifact.createdAt);
    const newestCreated = Date.parse(currentNewest.createdAt);
    if (candidateCreated > newestCreated) {
      newestByGroup.set(groupKey, buildArtifact);
    }
  }
  return newestByGroup;
};

/** Split an artifact index by retention + keep-newest-per-app+platform policy. */
export const planPrune = (
  artifactIndex: BuildArtifact[],
  pruneOptions: Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>,
): { prune: BuildArtifact[]; keep: BuildArtifact[] } => {
  const newestByGroup = newestArtifactByGroup(artifactIndex);
  const artifactsToPrune: BuildArtifact[] = [];
  const artifactsToKeep: BuildArtifact[] = [];
  for (const buildArtifact of artifactIndex) {
    const ageInDays = artifactAgeDays(buildArtifact, pruneOptions.now);
    let matchesApp = true;
    if (pruneOptions.app !== undefined) matchesApp = buildArtifact.appName === pruneOptions.app;
    let matchesPlatform = true;
    if (pruneOptions.platform !== undefined) {
      matchesPlatform = buildArtifact.platform === pruneOptions.platform;
    }
    const isGroupNewest = newestByGroup.get(artifactGroupKey(buildArtifact)) === buildArtifact;
    const shouldPrune =
      pruneOptions.retentionDays > 0 &&
      buildArtifact.prunedAt === undefined &&
      !isGroupNewest &&
      matchesApp &&
      matchesPlatform &&
      ageInDays !== null &&
      ageInDays > pruneOptions.retentionDays;
    if (shouldPrune) artifactsToPrune.push(buildArtifact);
    else artifactsToKeep.push(buildArtifact);
  }
  return { prune: artifactsToPrune, keep: artifactsToKeep };
};

const prunedArtifactEntry = (
  buildArtifact: BuildArtifact,
  artifactBytes: number,
): PrunedArtifact => ({
  app: buildArtifact.appName,
  platform: buildArtifact.platform,
  version: buildArtifact.version,
  buildNumber: buildArtifact.buildNumber,
  bytes: artifactBytes,
  path: buildArtifact.path,
});

const readArtifactBytes = (
  buildArtifact: BuildArtifact,
): Effect.Effect<number, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(buildArtifact.path))) {
      return buildArtifact.sizeReport.artifactBytes;
    }
    return Number((yield* fileSystem.stat(buildArtifact.path)).size);
  });

/** Stamp prunedAt on pruned rows without mutating the source index entries. */
const stampPrunedArtifacts = (
  artifactIndex: BuildArtifact[],
  prunedArtifacts: readonly BuildArtifact[],
  prunedAt: string,
): BuildArtifact[] => {
  // planPrune returns the same object refs that live in the index.
  const prunedIdentity = new Set<BuildArtifact>(prunedArtifacts);
  return artifactIndex.map((buildArtifact) => {
    if (!prunedIdentity.has(buildArtifact)) return buildArtifact;
    return { ...buildArtifact, prunedAt };
  });
};

/** Delete eligible artifacts and record the sweep in the artifact index. */
export const runArtifactPrune = (
  pruneOptions: PruneOptions & { indexPath?: string },
): Effect.Effect<PruneResult, PlatformError, ArtifactIndexRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const artifactIndex = yield* readArtifactIndex(pruneOptions.indexPath);
    const policyInput: Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'> = {
      now: pruneOptions.now,
      retentionDays: pruneOptions.retentionDays,
    };
    if (pruneOptions.app !== undefined) policyInput.app = pruneOptions.app;
    if (pruneOptions.platform !== undefined) policyInput.platform = pruneOptions.platform;
    const artifactsToPrune = planPrune(artifactIndex, policyInput).prune;
    const prunedEntries: PrunedArtifact[] = [];
    let freedBytes = 0;
    let dryRun = false;
    if (pruneOptions.dryRun !== undefined) dryRun = pruneOptions.dryRun;
    const prunedAt = new Date(pruneOptions.now).toISOString();
    for (const buildArtifact of artifactsToPrune) {
      const artifactBytes = yield* readArtifactBytes(buildArtifact);
      prunedEntries.push(prunedArtifactEntry(buildArtifact, artifactBytes));
      freedBytes += artifactBytes;
      if (dryRun) continue;
      if (yield* fileSystem.exists(buildArtifact.path)) {
        yield* fileSystem.remove(buildArtifact.path);
      }
    }
    if (!dryRun && prunedEntries.length > 0) {
      const writtenIndex = stampPrunedArtifacts(artifactIndex, artifactsToPrune, prunedAt);
      yield* writeArtifactIndex(writtenIndex, pruneOptions.indexPath);
    }
    return { pruned: prunedEntries, freedBytes, dryRun };
  });
