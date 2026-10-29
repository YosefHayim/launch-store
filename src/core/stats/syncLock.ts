import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Clock, Data, Effect } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { locateStatsDirectory, type LaunchPathsService } from '../services/paths.js';

const SYNC_LOCK_FILE_NAME = 'sync.lock';
const SYNC_LOCK_STALE_AFTER_MILLISECONDS = 5 * 60 * 1000;

export type SyncLockFailure = Readonly<{
  readonly _tag: 'SyncLockFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

const makeSyncLockFailure = Data.tagged<SyncLockFailure>('SyncLockFailure');

type SyncLockRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

// A lock older than the limit belongs to a crashed sync.
export const isSyncLockStale = (lockedAt: string, nowMilliseconds: number): boolean => {
  const lockedAtMilliseconds = Date.parse(lockedAt);
  const isTimeUnreadable = Number.isNaN(lockedAtMilliseconds);
  if (isTimeUnreadable) return true;
  return nowMilliseconds - lockedAtMilliseconds > SYNC_LOCK_STALE_AFTER_MILLISECONDS;
};

const isAlreadyExistsError = (error: PlatformError): boolean =>
  error._tag === 'SystemError' && error.reason === 'AlreadyExists';

const createLockFile = (
  fileSystem: FileSystem.FileSystem,
  lockFilePath: string,
  nowMilliseconds: number,
) =>
  fileSystem.writeFileString(lockFilePath, new Date(nowMilliseconds).toISOString(), {
    flag: 'wx',
  });

const acquireSyncLock = (): Effect.Effect<string, SyncLockFailure, SyncLockRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const statsDirectory = yield* locateStatsDirectory();
    const lockFilePath = pathService.join(statsDirectory, SYNC_LOCK_FILE_NAME);
    const nowMilliseconds = yield* Clock.currentTimeMillis;
    yield* fileSystem.makeDirectory(statsDirectory, { recursive: true });
    const isLockTaken = yield* createLockFile(fileSystem, lockFilePath, nowMilliseconds).pipe(
      Effect.as(false),
      Effect.catchIf(isAlreadyExistsError, () => Effect.succeed(true)),
    );
    const isLockFree = !isLockTaken;
    if (isLockFree) return lockFilePath;
    const lockedAt = yield* fileSystem.readFileString(lockFilePath);
    const isLockOld = isSyncLockStale(lockedAt, nowMilliseconds);
    const isAnotherSyncRunning = !isLockOld;
    if (isAnotherSyncRunning) {
      return yield* Effect.fail(new Error(`Another stats sync is running (started ${lockedAt}).`));
    }
    yield* fileSystem.remove(lockFilePath, { force: true });
    yield* createLockFile(fileSystem, lockFilePath, nowMilliseconds);
    return lockFilePath;
  }).pipe(
    Effect.mapError((cause) =>
      makeSyncLockFailure({
        message: `Could not lock the stats sync: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );

const releaseSyncLock = (lockFilePath: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.remove(lockFilePath, { force: true });
  }).pipe(Effect.orDie);

export const holdSyncLock = <Success, Failure, Requirements>(
  syncProgram: Effect.Effect<Success, Failure, Requirements>,
): Effect.Effect<Success, Failure | SyncLockFailure, Requirements | SyncLockRequirements> =>
  Effect.acquireUseRelease(acquireSyncLock(), () => syncProgram, releaseSyncLock);
