import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import type { AppCoverage } from '../types/stats.js';
import { createEmptyAppCoverage, loadAppCoverage, saveAppCoverage } from './coverageStore.js';

let homeDirectory: string;
beforeEach(() => {
  homeDirectory = createTemporaryHomeDirectory();
});
afterEach(() => {
  removeTemporaryHomeDirectory(homeDirectory);
});

const coverage: AppCoverage = {
  version: 1,
  appKey: 'ios-1',
  feeds: {
    'app-store': {
      lastSyncedAt: '2026-10-29T08:00:00.000Z',
      coveredFrom: '2026-10-01',
      coveredThrough: '2026-10-28',
      lastError: null,
      lastNote: 'Apple is preparing',
    },
  },
};

describe('createEmptyAppCoverage', () => {
  test('has no feeds', () => {
    expect(createEmptyAppCoverage('ios-1')).toEqual({ version: 1, appKey: 'ios-1', feeds: {} });
  });
});

describe('loadAppCoverage', () => {
  test('returns an empty coverage when the app was never synced', async () => {
    const loaded = await Effect.runPromise(
      loadAppCoverage('ios-1').pipe(Effect.provide(makeLaunchHomeTest(homeDirectory))),
    );

    expect(loaded).toEqual(createEmptyAppCoverage('ios-1'));
  });

  test('fails for an app key that is not valid', async () => {
    const failure = await Effect.runPromise(
      loadAppCoverage('../x').pipe(Effect.flip, Effect.provide(makeLaunchHomeTest(homeDirectory))),
    );

    expect(failure._tag).toBe('InvalidAppKeyFailure');
  });
});

describe('loadAppCoverage with a file saved before lastNote existed', () => {
  test('decodes it with a null lastNote', async () => {
    const oldFile = {
      version: 1,
      appKey: 'ios-1',
      feeds: {
        'app-store': {
          lastSyncedAt: '2026-10-29T08:00:00.000Z',
          coveredFrom: '2026-10-01',
          coveredThrough: '2026-10-28',
          lastError: null,
        },
      },
    };
    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', JSON.stringify(oldFile));

    const loaded = await Effect.runPromise(
      loadAppCoverage('ios-1').pipe(Effect.provide(makeLaunchHomeTest(homeDirectory))),
    );

    expect(loaded.feeds['app-store']).toMatchObject({ lastError: null, lastNote: null });
  });
});

describe('saveAppCoverage', () => {
  test('saves the coverage so the next load returns it', async () => {
    const program = Effect.gen(function* () {
      yield* saveAppCoverage(coverage);
      return yield* loadAppCoverage('ios-1');
    });

    const loaded = await Effect.runPromise(
      program.pipe(Effect.provide(makeLaunchHomeTest(homeDirectory))),
    );

    expect(loaded).toEqual(coverage);
  });
});
