import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { DailyStat } from '../types/stats.ts';
import { saveDailyStats } from './stats-store.ts';

function createStat(overrides: Partial<DailyStat>): DailyStat {
  return {
    date: '2026-10-01',
    feed: 'app-store',
    metric: 'downloads',
    value: 1,
    currency: null,
    ...overrides,
  };
}

function describeSaveDailyStats() {
  let homeDirectory: string;

  function prepareSaveDailyStats() {
    homeDirectory = createTemporaryHomeDirectory();

    const workPath = join(homeDirectory, 'work');

    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });
  }

  beforeEach(prepareSaveDailyStats);

  function cleanupSaveDailyStats() {
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupSaveDailyStats);

  function appFolder(): string {
    return join(homeDirectory, '.launch', 'stats', 'ios-1');
  }

  async function saveInHome(stats: readonly DailyStat[]): Promise<void> {
    await saveDailyStats('ios-1', stats);
  }

  async function writesOneFilePerMonth() {
    const stat = createStat({ date: '2026-09-30' });
    await saveInHome([stat, createStat({ date: '2026-10-01' })]);

    expect(readdirSync(appFolder()).sort()).toEqual(['2026-09.json', '2026-10.json']);
  }

  test('writes one file per month', writesOneFilePerMonth);

  async function mergesWithTheDaysAlreadySavedInThatMonth() {
    const stat = createStat({ date: '2026-10-01', value: 1 });

    await saveInHome([stat, createStat({ date: '2026-10-02', value: 2 })]);

    await saveInHome([
      createStat({ date: '2026-10-02', value: 9 }),
      createStat({ date: '2026-10-03', value: 3 }),
    ]);

    const joinedPath = join(appFolder(), '2026-10.json');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    const monthFile = JSON.parse(loadedFile);

    function readDayFigure(stat: DailyStat) {
      return [stat.date, stat.value];
    }

    expect(monthFile.stats.map(readDayFigure)).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 9],
      ['2026-10-03', 3],
    ]);
    expect(monthFile).toMatchObject({ version: 1, appKey: 'ios-1', month: '2026-10' });
  }

  test(
    'merges with the days already saved in that month',
    mergesWithTheDaysAlreadySavedInThatMonth,
  );

  async function writesNothingForNoStats() {
    await saveInHome([]);

    function expectCall() {
      return readdirSync(appFolder());
    }

    expect(expectCall).toThrow();
  }

  test('writes nothing for no stats', writesNothingForNoStats);

  async function failsForAnAppKeyThatIsNotValid() {
    const stat = createStat({});
    await expect(saveDailyStats('bad key', [stat])).rejects.toMatchObject({
      _tag: 'InvalidAppKeyFailure',
    });
  }

  test('fails for an app key that is not valid', failsForAnAppKeyThatIsNotValid);
}

describe('saveDailyStats', describeSaveDailyStats);
