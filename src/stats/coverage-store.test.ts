import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { AppCoverage } from '../types/stats.ts';
import { createEmptyAppCoverage, loadAppCoverage, saveAppCoverage } from './coverage-store.ts';

let homeDirectory: string;

function useTemporaryLaunchHome(): void {
  const workPath = join(homeDirectory, 'work');
  useLaunchDirectories({
    homeDirectory,
    workingDirectory: workPath,
  });
}

beforeEach(() => {
  homeDirectory = createTemporaryHomeDirectory();
  useTemporaryLaunchHome();
});

afterEach(() => {
  resetLaunchDirectories();
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
    const emptyAppCoverage = createEmptyAppCoverage('ios-1');
    expect(emptyAppCoverage).toEqual({ version: 1, appKey: 'ios-1', feeds: {} });
  });
});

describe('loadAppCoverage', () => {
  test('returns an empty coverage when the app was never synced', async () => {
    const loaded = await loadAppCoverage('ios-1');

    const emptyAppCoverage = createEmptyAppCoverage('ios-1');
    expect(loaded).toEqual(emptyAppCoverage);
  });

  test('fails for an app key that is not valid', async () => {
    const appCoverage = loadAppCoverage('../x');
    await expect(appCoverage).rejects.toMatchObject({ _tag: 'InvalidAppKeyFailure' });
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
    const serialized = JSON.stringify(oldFile);
    writeLaunchHomeFile(homeDirectory, 'stats/ios-1/coverage.json', serialized);

    const loaded = await loadAppCoverage('ios-1');

    expect(loaded.feeds['app-store']).toMatchObject({ lastError: null, lastNote: null });
  });
});

describe('saveAppCoverage', () => {
  test('saves the coverage so the next load returns it', async () => {
    await saveAppCoverage(coverage);
    const loaded = await loadAppCoverage('ios-1');

    expect(loaded).toEqual(coverage);
  });
});
