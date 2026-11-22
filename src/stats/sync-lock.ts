import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from '../services/platform/error-message.ts';
import { locateStatsDirectory } from '../services/platform/paths.ts';

const syncLockStaleAfterMilliseconds = 5 * 60 * 1000;

export type SyncLockFailure = Readonly<{
  readonly _tag: 'SyncLockFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeSyncLockFailure(fields: { message: string; cause: unknown }): SyncLockFailure {
  return { _tag: 'SyncLockFailure', message: fields.message, cause: fields.cause };
}

// A lock older than the limit belongs to a crashed sync.
export function isSyncLockStale(lockedAt: string, nowMilliseconds: number): boolean {
  const lockedAtMilliseconds = Date.parse(lockedAt);
  const isTimeUnreadable = Number.isNaN(lockedAtMilliseconds);

  if (isTimeUnreadable) {
    return true;
  }

  return nowMilliseconds - lockedAtMilliseconds > syncLockStaleAfterMilliseconds;
}

function isAlreadyExistsError(cause: unknown): boolean {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('code' in cause == false) {
    return false;
  }

  return cause.code == 'EEXIST';
}

async function claimLockFile(lockFilePath: string, nowMilliseconds: number): Promise<boolean> {
  try {
    await writeFile(lockFilePath, new Date(nowMilliseconds).toISOString(), { flag: 'wx' });

    return true;
  } catch (cause) {
    if (isAlreadyExistsError(cause)) {
      return false;
    }

    throw cause;
  }
}

async function claimSyncLock(): Promise<string> {
  const statsDirectory = locateStatsDirectory();
  const lockFilePath = join(statsDirectory, 'sync.lock');
  const nowMilliseconds = Date.now();

  await mkdir(statsDirectory, { recursive: true });
  const isLockClaimed = await claimLockFile(lockFilePath, nowMilliseconds);

  if (isLockClaimed) {
    return lockFilePath;
  }

  const lockedAt = await readFile(lockFilePath, 'utf8');
  const isLockOld = isSyncLockStale(lockedAt, nowMilliseconds);

  if (isLockOld == false) {
    throw new Error(`Another stats sync is running (started ${lockedAt}).`);
  }

  await rm(lockFilePath, { force: true });
  const isStaleLockClaimed = await claimLockFile(lockFilePath, nowMilliseconds);

  if (isStaleLockClaimed == false) {
    throw new Error(`Another stats sync is running (started ${lockedAt}).`);
  }

  return lockFilePath;
}

async function acquireSyncLock(): Promise<string> {
  try {
    return await claimSyncLock();
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw makeSyncLockFailure({
      message: `Could not lock the stats sync: ${failureMessage}`,
      cause,
    });
  }
}

export async function holdSyncLock<Success>(syncWork: () => Promise<Success>): Promise<Success> {
  const lockFilePath = await acquireSyncLock();

  try {
    return await syncWork();
  } finally {
    await rm(lockFilePath, { force: true });
  }
}
