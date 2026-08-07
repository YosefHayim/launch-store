import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect, Schema } from 'effect';
import {
  resolveSnapshotFilePath,
  resolveSnapshotsDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import type {
  AppEntities,
  CaptureOutcome,
  CaptureReport,
  JsonValue,
  Snapshot,
  SnapshotEntity,
} from '../types/snapshot.js';

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  ),
);

const SnapshotEntitySchema: Schema.Schema<SnapshotEntity> = Schema.Struct({
  key: Schema.String,
  summary: Schema.String,
  data: JsonValueSchema,
});

const AppEntitiesSchema: Schema.Schema<AppEntities> = Schema.Struct({
  app: Schema.String,
  identifier: Schema.String,
  entities: Schema.Array(SnapshotEntitySchema),
});

const CaptureOutcomeSchema: Schema.Schema<CaptureOutcome> = Schema.Union(
  Schema.Struct({ state: Schema.Literal('omitted') }),
  Schema.Struct({
    state: Schema.Literal('skipped'),
    reason: Schema.String,
    hint: Schema.optionalWith(Schema.String, { exact: true }),
  }),
  Schema.Struct({
    state: Schema.Literal('captured'),
    apps: Schema.Array(AppEntitiesSchema),
  }),
  Schema.Struct({
    state: Schema.Literal('errored'),
    error: Schema.String,
  }),
);

const CaptureReportSchema: Schema.Schema<CaptureReport> = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  store: Schema.Literal('appstore', 'play'),
  outcome: CaptureOutcomeSchema,
});

const SnapshotSchema: Schema.Schema<Snapshot> = Schema.Struct({
  version: Schema.Number,
  name: Schema.String,
  capturedAt: Schema.String,
  reports: Schema.Array(CaptureReportSchema),
});

type SnapshotStoreRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Resolve the persisted snapshot directory or an explicit test/CLI override. */
const snapshotDirectory = (
  directoryOverride: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> => {
  if (directoryOverride !== undefined) return Effect.succeed(directoryOverride);
  return resolveSnapshotsDirectory();
};

/** Resolve a sanitized snapshot file path. */
const snapshotFilePath = (
  snapshotName: string,
  directoryOverride: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    if (directoryOverride === undefined) return yield* resolveSnapshotFilePath(snapshotName);
    const pathService = yield* Path.Path;
    const sanitizedName = snapshotName.replace(/[^A-Za-z0-9_-]/g, '');
    let fileName = 'snapshot';
    if (sanitizedName.length > 0) fileName = sanitizedName;
    return pathService.join(directoryOverride, `${fileName}.json`);
  });

/** Decode one persisted snapshot with the schema that owns its shape. */
const decodeSnapshot = (snapshotText: string): Effect.Effect<Snapshot, unknown> =>
  Effect.try(() => JSON.parse(snapshotText)).pipe(
    Effect.flatMap(Schema.decodeUnknown(SnapshotSchema)),
  );

/** Persist one snapshot and return its file path. */
export const saveSnapshot = (
  snapshot: Snapshot,
  directoryOverride?: string,
): Effect.Effect<string, PlatformError, SnapshotStoreRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directoryPath = yield* snapshotDirectory(directoryOverride);
    const filePath = yield* snapshotFilePath(snapshot.name, directoryOverride);
    yield* fileSystem.makeDirectory(directoryPath, { recursive: true });
    yield* fileSystem.writeFileString(filePath, JSON.stringify(snapshot, null, 2));
    return filePath;
  });

/** Load one snapshot, returning null for absent, unreadable, or malformed files. */
export const loadSnapshot = (
  snapshotName: string,
  directoryOverride?: string,
): Effect.Effect<Snapshot | null, never, SnapshotStoreRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const filePath = yield* snapshotFilePath(snapshotName, directoryOverride);
    const fileExists = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!fileExists) return null;
    return yield* fileSystem.readFileString(filePath).pipe(
      Effect.flatMap(decodeSnapshot),
      Effect.map((snapshot): Snapshot | null => snapshot),
      Effect.orElseSucceed(() => null),
    );
  });

/** List valid snapshots newest first. */
export const listSnapshots = (
  directoryOverride?: string,
): Effect.Effect<readonly Snapshot[], never, SnapshotStoreRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directoryPath = yield* snapshotDirectory(directoryOverride);
    const directoryExists = yield* fileSystem
      .exists(directoryPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!directoryExists) return [];
    const entryNames = yield* fileSystem
      .readDirectory(directoryPath)
      .pipe(Effect.orElseSucceed(() => []));
    const snapshotCandidates = yield* Effect.forEach(
      entryNames.filter((entryName) => entryName.endsWith('.json')),
      (entryName) =>
        fileSystem.readFileString(pathService.join(directoryPath, entryName)).pipe(
          Effect.flatMap(decodeSnapshot),
          Effect.map((snapshot): Snapshot | null => snapshot),
          Effect.orElseSucceed(() => null),
        ),
      { concurrency: 'unbounded' },
    );
    return snapshotCandidates
      .filter((snapshot): snapshot is Snapshot => snapshot !== null)
      .sort((firstSnapshot, secondSnapshot) =>
        secondSnapshot.capturedAt.localeCompare(firstSnapshot.capturedAt),
      );
  });

/** Prune old snapshots with a matching reserved prefix. */
export const pruneSnapshots = (
  namePrefix: string,
  keepCount: number,
  directoryOverride?: string,
): Effect.Effect<readonly string[], never, SnapshotStoreRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const storedSnapshots = yield* listSnapshots(directoryOverride);
    const staleSnapshots = storedSnapshots
      .filter((snapshot) => snapshot.name.startsWith(namePrefix))
      .slice(Math.max(0, keepCount));
    const deletionAttempts = yield* Effect.forEach(
      staleSnapshots,
      (snapshot) =>
        Effect.gen(function* () {
          const filePath = yield* snapshotFilePath(snapshot.name, directoryOverride);
          return yield* fileSystem.remove(filePath, { force: true }).pipe(
            Effect.map((): string | null => snapshot.name),
            Effect.orElseSucceed(() => null),
          );
        }),
      { concurrency: 1 },
    );
    return deletionAttempts.filter((snapshotName): snapshotName is string => snapshotName !== null);
  });

/** Delete one snapshot and report whether its file existed. */
export const deleteSnapshot = (
  snapshotName: string,
  directoryOverride?: string,
): Effect.Effect<boolean, never, SnapshotStoreRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const filePath = yield* snapshotFilePath(snapshotName, directoryOverride);
    const fileExists = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!fileExists) return false;
    return yield* fileSystem.remove(filePath, { force: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  });

export type PruneCriteria = {
  keep?: number;
  olderThanDays?: number;
};

/** Calculate the age of a snapshot capture in fractional days. */
const ageInDays = (capturedAt: string, now: Date): number =>
  (now.getTime() - new Date(capturedAt).getTime()) / 86_400_000;

/** Select snapshots matching either configured prune rule. */
export const planPrune = (
  snapshots: Snapshot[],
  criteria: PruneCriteria,
  now: Date,
): Snapshot[] => {
  const newestFirst = [...snapshots].sort((firstSnapshot, secondSnapshot) =>
    secondSnapshot.capturedAt.localeCompare(firstSnapshot.capturedAt),
  );
  return newestFirst.filter((snapshot, snapshotIndex) => {
    let tooOld = false;
    if (criteria.olderThanDays !== undefined)
      tooOld = ageInDays(snapshot.capturedAt, now) > criteria.olderThanDays;
    let beyondKeep = false;
    if (criteria.keep !== undefined) beyondKeep = snapshotIndex >= criteria.keep;
    if (tooOld) return true;
    return beyondKeep;
  });
};
