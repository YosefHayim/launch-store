import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/temporary-launch-home.ts';
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

function prepare() {
  homeDirectory = createTemporaryHomeDirectory();
  useTemporaryLaunchHome();
}

beforeEach(prepare);

function cleanup() {
  resetLaunchDirectories();
  removeTemporaryHomeDirectory(homeDirectory);
}

afterEach(cleanup);

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

function describeCreateEmptyAppCoverage() {
  function hasNoFeeds() {
    const emptyAppCoverage = createEmptyAppCoverage('ios-1');
    expect(emptyAppCoverage).toEqual({ version: 1, appKey: 'ios-1', feeds: {} });
  }

  test('has no feeds', hasNoFeeds);
}

describe('createEmptyAppCoverage', describeCreateEmptyAppCoverage);

function describeLoadAppCoverage() {
  async function returnsAnEmptyCoverageWhenTheAppWasNeverSynced() {
    const loaded = await loadAppCoverage('ios-1');

    const emptyAppCoverage = createEmptyAppCoverage('ios-1');
    expect(loaded).toEqual(emptyAppCoverage);
  }

  test(
    'returns an empty coverage when the app was never synced',
    returnsAnEmptyCoverageWhenTheAppWasNeverSynced,
  );

  async function failsForAnAppKeyThatIsNotValid() {
    const appCoverage = loadAppCoverage('../x');
    await expect(appCoverage).rejects.toThrow('not a valid app key');
  }

  test('fails for an app key that is not valid', failsForAnAppKeyThatIsNotValid);
}

describe('loadAppCoverage', describeLoadAppCoverage);

function describeLoadAppCoverageWithAFileSavedBeforeLastNoteExisted() {
  async function decodesItWithANullLastNote() {
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
  }

  test('decodes it with a null lastNote', decodesItWithANullLastNote);
}

describe(
  'loadAppCoverage with a file saved before lastNote existed',
  describeLoadAppCoverageWithAFileSavedBeforeLastNoteExisted,
);

function describeSaveAppCoverage() {
  async function savesTheCoverageSoTheNextLoadReturnsIt() {
    await saveAppCoverage(coverage);
    const loaded = await loadAppCoverage('ios-1');

    expect(loaded).toEqual(coverage);
  }

  test('saves the coverage so the next load returns it', savesTheCoverageSoTheNextLoadReturnsIt);
}

describe('saveAppCoverage', describeSaveAppCoverage);
