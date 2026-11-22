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

describe('isSyncLockStale', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  test('is fresh within 5 minutes', () => {
    expect(isSyncLockStale('2026-10-29T11:56:00.000Z', now)).toBe(false);
  });

  test('is stale after 5 minutes', () => {
    expect(isSyncLockStale('2026-10-29T11:54:00.000Z', now)).toBe(true);
  });

  test('is stale when the time cannot be read', () => {
    expect(isSyncLockStale('garbage', now)).toBe(true);
  });
});

describe('holdSyncLock', () => {
  let homeDirectory: string;

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    const workPath = join(homeDirectory, 'work');
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
  });

  afterEach(() => {
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  function lockPath(): string {
    return join(homeDirectory, '.launch', 'stats', 'sync.lock');
  }

  function runLocked<Success>(syncWork: () => Promise<Success>): Promise<Success> {
    return holdSyncLock(syncWork);
  }

  test('holds the lock while the program runs and removes it after', async () => {
    async function wasLocked(): Promise<boolean> {
      return existsSync(lockPath());
    }

    const wasLockedDuring = await runLocked(wasLocked);

    expect(wasLockedDuring).toBe(true);
    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(false);
  });

  test('removes the lock when the program fails', async () => {
    async function failProgram(): Promise<void> {
      throw new Error('boom');
    }

    const locked = runLocked(failProgram);
    await expect(locked).rejects.toThrow('boom');

    const pathExists = existsSync(lockPath());
    expect(pathExists).toBe(false);
  });

  test('refuses to start while a fresh lock exists', async () => {
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
  });

  test('takes over a stale lock and removes it after', async () => {
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
  });
});
