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
import type { MutableDeep } from '../types/mutable.js';

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ArtifactIndexRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

const resolveArtifactIndexPath = (
  indexPath: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> => {
  if (indexPath !== undefined) return Effect.succeed(indexPath);
  return resolveArtifactIndexFilePath();
};

/** Read and decode the newest-first artifact index, tolerating absent or malformed state. */
export const readArtifactIndex = (
  indexPath?: string,
): Effect.Effect<readonly BuildArtifact[], never, ArtifactIndexRequirements> =>
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
  artifactIndex: readonly BuildArtifact[],
  indexPath?: string,
): Effect.Effect<void, PlatformError, ArtifactIndexRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const artifactIndexPath = yield* resolveArtifactIndexPath(indexPath);
    yield* fileSystem.makeDirectory(pathService.dirname(artifactIndexPath), { recursive: true });
    yield* fileSystem.writeFileString(artifactIndexPath, JSON.stringify(artifactIndex, null, 2));
  });

export const resolveRetentionDays = (launchConfig: LaunchConfig): number => {
  if (launchConfig.artifactRetentionDays === undefined) return DEFAULT_RETENTION_DAYS;
  return launchConfig.artifactRetentionDays;
};

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

/** Split an artifact index according to the retention and keep-newest policy. */
export const planPrune = (
  artifactIndex: readonly BuildArtifact[],
  pruneOptions: Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>,
): { prune: BuildArtifact[]; keep: BuildArtifact[] } => {
  const newestArtifactByGroup = new Map<string, BuildArtifact>();
  for (const buildArtifact of artifactIndex) {
    const groupKey = artifactGroupKey(buildArtifact);
    const newestArtifact = newestArtifactByGroup.get(groupKey);
    if (newestArtifact === undefined) {
      newestArtifactByGroup.set(groupKey, buildArtifact);
      continue;
    }
    if (Date.parse(buildArtifact.createdAt) > Date.parse(newestArtifact.createdAt)) {
      newestArtifactByGroup.set(groupKey, buildArtifact);
    }
  }
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
    const shouldPrune =
      pruneOptions.retentionDays > 0 &&
      buildArtifact.prunedAt === undefined &&
      newestArtifactByGroup.get(artifactGroupKey(buildArtifact)) !== buildArtifact &&
      matchesApp &&
      matchesPlatform &&
      ageInDays !== null &&
      ageInDays > pruneOptions.retentionDays;
    if (shouldPrune) artifactsToPrune.push(buildArtifact);
    else artifactsToKeep.push(buildArtifact);
  }
  return { prune: artifactsToPrune, keep: artifactsToKeep };
};

const toPrunedArtifact = (buildArtifact: BuildArtifact, artifactBytes: number): PrunedArtifact => ({
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

/** Delete eligible artifacts and record the sweep in the artifact index. */
export const runArtifactPrune = (
  pruneOptions: PruneOptions & { indexPath?: string },
): Effect.Effect<PruneResult, PlatformError, ArtifactIndexRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const artifactIndex = yield* readArtifactIndex(pruneOptions.indexPath);
    const policyInput: MutableDeep<
      Pick<PruneOptions, 'now' | 'retentionDays' | 'app' | 'platform'>
    > = {
      now: pruneOptions.now,
      retentionDays: pruneOptions.retentionDays,
    };
    if (pruneOptions.app !== undefined) policyInput.app = pruneOptions.app;
    if (pruneOptions.platform !== undefined) policyInput.platform = pruneOptions.platform;
    const artifactsToPrune = planPrune(artifactIndex, policyInput).prune;
    const prunedArtifacts: PrunedArtifact[] = [];
    let freedBytes = 0;
    let dryRun = false;
    if (pruneOptions.dryRun !== undefined) dryRun = pruneOptions.dryRun;
    const prunedAt = new Date(pruneOptions.now).toISOString();
    for (const buildArtifact of artifactsToPrune) {
      const artifactBytes = yield* readArtifactBytes(buildArtifact);
      prunedArtifacts.push(toPrunedArtifact(buildArtifact, artifactBytes));
      freedBytes += artifactBytes;
      if (dryRun) continue;
      if (yield* fileSystem.exists(buildArtifact.path)) {
        yield* fileSystem.remove(buildArtifact.path);
      }
      buildArtifact.prunedAt = prunedAt;
    }
    if (!dryRun && prunedArtifacts.length > 0) {
      yield* writeArtifactIndex(artifactIndex, pruneOptions.indexPath);
    }
    return { pruned: prunedArtifacts, freedBytes, dryRun };
  });
