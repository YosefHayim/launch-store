import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import {
  type LaunchPathsService,
  resolveReleaseTrainFilePath,
  resolveReleaseTrainsDirectory,
} from '../services/paths.js';
import type { TrainRecord } from '../types/releaseTrain.js';

const NativeCarSchema = Schema.Struct({
  kind: Schema.Literal('ios', 'android'),
  state: Schema.Literal(
    'building',
    'submitted',
    'in-review',
    'approved',
    'released',
    'rejected',
    'failed',
  ),
  buildId: Schema.optionalWith(Schema.String, { exact: true }),
  error: Schema.optionalWith(Schema.String, { exact: true }),
  updatedAt: Schema.String,
});

const OtaCarSchema = Schema.Struct({
  kind: Schema.Literal('ota'),
  platform: Schema.Literal('ios', 'android'),
  channel: Schema.String,
  runtimeVersion: Schema.String,
  state: Schema.Literal('pending', 'published'),
  manifestId: Schema.optionalWith(Schema.String, { exact: true }),
  updatedAt: Schema.String,
});

const TrainRecordSchema: Schema.Schema<TrainRecord> = Schema.Struct({
  id: Schema.String,
  app: Schema.String,
  hold: Schema.Boolean,
  state: Schema.Literal('running', 'blocked', 'done', 'aborted'),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  cars: Schema.Array(Schema.Union(NativeCarSchema, OtaCarSchema)),
});

/** A persisted release-train record could not be read or written. */
export type TrainRecordFailure = Readonly<{
  readonly _tag: 'TrainRecordFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeTrainRecordFailure = Data.tagged<TrainRecordFailure>('TrainRecordFailure');

/** Platform services used by release-train record persistence. */
export type TrainRecordRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Whether a train is still live (running or blocked). */
export const isLiveTrain = (trainRecord: TrainRecord): boolean => {
  if (trainRecord.state === 'running') return true;
  return trainRecord.state === 'blocked';
};

const recordFailure = (operation: string, cause: unknown): TrainRecordFailure => {
  let message = errorMessage(cause);
  if (message.length === 0) message = `${operation} failed.`;
  return makeTrainRecordFailure({ operation, message, cause });
};

/** Sanitize a train id before it becomes a filename. */
export const safeTrainId = (trainId: string): string => {
  const sanitizedTrainId = trainId.replace(/[^A-Za-z0-9_-]/g, '');
  if (sanitizedTrainId.length === 0) return 'train';
  return sanitizedTrainId;
};

const releaseTrainDirectory = (
  directoryOverride: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    if (directoryOverride !== undefined) return directoryOverride;
    return yield* resolveReleaseTrainsDirectory();
  });

const trainRecordPath = (
  trainId: string,
  directoryOverride: string | undefined,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    if (directoryOverride === undefined) return yield* resolveReleaseTrainFilePath(trainId);
    const pathService = yield* Path.Path;
    return pathService.join(directoryOverride, `${safeTrainId(trainId)}.json`);
  });

/** Persist a train record, creating the release-trains directory when needed. */
export const writeTrainRecord = (
  trainRecord: TrainRecord,
  directoryOverride?: string,
): Effect.Effect<void, TrainRecordFailure, TrainRecordRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = yield* trainRecordPath(trainRecord.id, directoryOverride);
    yield* fileSystem
      .makeDirectory(pathService.dirname(filePath), { recursive: true })
      .pipe(Effect.mapError((cause) => recordFailure('create release-train directory', cause)));
    yield* fileSystem
      .writeFileString(filePath, JSON.stringify(trainRecord, null, 2))
      .pipe(Effect.mapError((cause) => recordFailure('write release-train record', cause)));
  });

/** Read one train by id, returning null for absent, unreadable, or malformed files. */
export const readTrainRecord = (
  trainId: string,
  directoryOverride?: string,
): Effect.Effect<TrainRecord | null, never, TrainRecordRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const filePath = yield* trainRecordPath(trainId, directoryOverride);
    const fileExists = yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!fileExists) return null;
    return yield* fileSystem.readFileString(filePath).pipe(
      Effect.flatMap(Schema.decodeUnknown(Schema.parseJson(TrainRecordSchema))),
      Effect.map((trainRecord): TrainRecord => trainRecord),
      Effect.orElseSucceed(() => null),
    );
  });

/** List every valid persisted train newest-first. */
export const listTrainRecords = (
  directoryOverride?: string,
): Effect.Effect<TrainRecord[], TrainRecordFailure, TrainRecordRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directoryPath = yield* releaseTrainDirectory(directoryOverride);
    const directoryExists = yield* fileSystem
      .exists(directoryPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!directoryExists) return [];
    const directoryEntries = yield* fileSystem
      .readDirectory(directoryPath)
      .pipe(Effect.mapError((cause) => recordFailure('list release-train records', cause)));
    const trainRecords = yield* Effect.forEach(
      directoryEntries,
      (directoryEntry) => {
        if (!directoryEntry.endsWith('.json')) return Effect.succeed(null);
        return readTrainRecord(directoryEntry.slice(0, -'.json'.length), directoryPath);
      },
      { concurrency: 'unbounded' },
    );
    return trainRecords
      .filter((trainRecord): trainRecord is TrainRecord => trainRecord !== null)
      .sort((firstTrain, secondTrain) => secondTrain.createdAt.localeCompare(firstTrain.createdAt));
  });

/** Resolve the newest live train, then the newest train of any state. */
export const latestTrainRecord = (
  directoryOverride?: string,
): Effect.Effect<TrainRecord | null, TrainRecordFailure, TrainRecordRequirements> =>
  Effect.gen(function* () {
    const trainRecords = yield* listTrainRecords(directoryOverride);
    const liveTrain = trainRecords.find(isLiveTrain);
    if (liveTrain !== undefined) return liveTrain;
    const newestTrain = trainRecords[0];
    if (newestTrain === undefined) return null;
    return newestTrain;
  });

/** Remove one persisted train record when it exists. */
export const removeTrainRecord = (
  trainId: string,
  directoryOverride?: string,
): Effect.Effect<void, TrainRecordFailure, TrainRecordRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const filePath = yield* trainRecordPath(trainId, directoryOverride);
    yield* fileSystem
      .remove(filePath, { force: true })
      .pipe(Effect.mapError((cause) => recordFailure('remove release-train record', cause)));
  });
