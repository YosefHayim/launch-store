import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { isSyncLockStale, holdSyncLock } from './syncLock.js';

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
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const lockPath = () => join(homeDirectory, '.launch', 'stats', 'sync.lock');
  const runLocked = <Success, Failure>(program: Effect.Effect<Success, Failure>) =>
    Effect.runPromise(
      holdSyncLock(program).pipe(Effect.provide(makeLaunchHomeTest(homeDirectory))),
    );

  test('holds the lock while the program runs and removes it after', async () => {
    const wasLockedDuring = await runLocked(Effect.sync(() => existsSync(lockPath())));

    expect(wasLockedDuring).toBe(true);
    expect(existsSync(lockPath())).toBe(false);
  });

  test('removes the lock when the program fails', async () => {
    await expect(runLocked(Effect.fail(new Error('boom')))).rejects.toThrow('boom');

    expect(existsSync(lockPath())).toBe(false);
  });

  test('refuses to start while a fresh lock exists', async () => {
    writeLaunchHomeFile(homeDirectory, join('stats', 'sync.lock'), new Date().toISOString());

    await expect(runLocked(Effect.void)).rejects.toThrow('Another stats sync is running');

    expect(existsSync(lockPath())).toBe(true);
  });

  test('takes over a stale lock and removes it after', async () => {
    const staleLockStamp = '2020-01-01T00:00:00.000Z';
    writeLaunchHomeFile(homeDirectory, join('stats', 'sync.lock'), staleLockStamp);

    const lockStampDuringSync = await runLocked(
      Effect.sync(() => readFileSync(lockPath(), 'utf8')),
    );

    expect(lockStampDuringSync).not.toBe(staleLockStamp);
    expect(existsSync(lockPath())).toBe(false);
  });
});
