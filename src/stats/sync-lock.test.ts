import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { isSyncLockStale, holdSyncLock } from './sync-lock.ts';
function describeIsSyncLockStale() {
  const now = Date.parse('2026-10-29T12:00:00.000Z');
  function isFreshWithin5Minutes() {
    expect(isSyncLockStale('2026-10-29T11:56:00.000Z', now)).toBe(false);
  }

  test('is fresh within 5 minutes', isFreshWithin5Minutes);
  function isStaleAfter5Minutes() {
    expect(isSyncLockStale('2026-10-29T11:54:00.000Z', now)).toBe(true);
  }

  test('is stale after 5 minutes', isStaleAfter5Minutes);
  function isStaleWhenTheTimeCannotBeRead() {
    expect(isSyncLockStale('garbage', now)).toBe(true);
  }

  test('is stale when the time cannot be read', isStaleWhenTheTimeCannotBeRead);
}

describe('isSyncLockStale', describeIsSyncLockStale);
function describeHoldSyncLock() {
  let homeDirectory: string;
  function prepareHoldSyncLock() {
    homeDirectory = createTemporaryHomeDirectory();
    const workPath = join(homeDirectory, 'work');
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
  }

  beforeEach(prepareHoldSyncLock);
  function cleanupHoldSyncLock() {
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupHoldSyncLock);

  function lockPath(): string {
    return join(homeDirectory, '.launch', 'stats', 'sync.lock');
  }

  function runLocked<Success>(syncWork: () => Promise<Success>): Promise<Success> {
    return holdSyncLock(syncWork);
  }
  async function holdsTheLockWhileTheProgramRunsAndRemovesItAfter() {
    async function wasLocked(): Promise<boolean> {
      return existsSync(lockPath());
    }

    const wasLockedDuring = await runLocked(wasLocked);

    expect(wasLockedDuring).toBe(true);
    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(false);
  }

  test(
    'holds the lock while the program runs and removes it after',
    holdsTheLockWhileTheProgramRunsAndRemovesItAfter,
  );
  async function removesTheLockWhenTheProgramFails() {
    async function failProgram(): Promise<void> {
      throw new Error('boom');
    }

    const locked = runLocked(failProgram);
    await expect(locked).rejects.toThrow('boom');

    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(false);
  }

  test('removes the lock when the program fails', removesTheLockWhenTheProgramFails);
  async function refusesToStartWhileAFreshLockExists() {
    const syncPath = join('stats', 'sync.lock');
    writeLaunchHomeFile(homeDirectory, syncPath, new Date().toISOString());

    async function unusedWork(): Promise<void> {
      return undefined;
    }

    const locked = runLocked(unusedWork);
    await expect(locked).rejects.toMatchObject({
      _tag: 'SyncLockFailure',
      message: expect.stringContaining('Another stats sync is running'),
    });

    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(true);
  }

  test('refuses to start while a fresh lock exists', refusesToStartWhileAFreshLockExists);
  async function takesOverAStaleLockAndRemovesItAfter() {
    const staleLockStamp = '2020-01-01T00:00:00.000Z';
    const syncPath = join('stats', 'sync.lock');
    writeLaunchHomeFile(homeDirectory, syncPath, staleLockStamp);

    async function readLockStamp(): Promise<string> {
      return readFileSync(lockPath(), 'utf8');
    }

    const lockStampDuringSync = await runLocked(readLockStamp);

    expect(lockStampDuringSync).not.toBe(staleLockStamp);
    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(false);
  }

  test('takes over a stale lock and removes it after', takesOverAStaleLockAndRemovesItAfter);
}

describe('holdSyncLock', describeHoldSyncLock);
