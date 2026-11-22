import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
} from '../testkit/launchHome.testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { DailyStat } from '../types/stats.ts';
import { saveDailyStats } from './statsStore.ts';

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

describe('saveDailyStats', () => {
  let homeDirectory: string;

  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    useLaunchDirectories({
      homeDirectory,
      workingDirectory: join(homeDirectory, 'work'),
    });
  });

  afterEach(() => {
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  function appFolder(): string {
    return join(homeDirectory, '.launch', 'stats', 'ios-1');
  }

  async function saveInHome(stats: readonly DailyStat[]): Promise<void> {
    await saveDailyStats('ios-1', stats);
  }

  test('writes one file per month', async () => {
    await saveInHome([createStat({ date: '2026-09-30' }), createStat({ date: '2026-10-01' })]);

    expect(readdirSync(appFolder()).sort()).toEqual(['2026-09.json', '2026-10.json']);
  });

  test('merges with the days already saved in that month', async () => {
    await saveInHome([
      createStat({ date: '2026-10-01', value: 1 }),
      createStat({ date: '2026-10-02', value: 2 }),
    ]);

    await saveInHome([
      createStat({ date: '2026-10-02', value: 9 }),
      createStat({ date: '2026-10-03', value: 3 }),
    ]);

    const monthFile = JSON.parse(readFileSync(join(appFolder(), '2026-10.json'), 'utf8'));
    expect(monthFile.stats.map((stat: DailyStat) => [stat.date, stat.value])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 9],
      ['2026-10-03', 3],
    ]);
    expect(monthFile).toMatchObject({ version: 1, appKey: 'ios-1', month: '2026-10' });
  });

  test('writes nothing for no stats', async () => {
    await saveInHome([]);

    expect(() => readdirSync(appFolder())).toThrow();
  });

  test('fails for an app key that is not valid', async () => {
    await expect(saveDailyStats('bad key', [createStat({})])).rejects.toMatchObject({
      _tag: 'InvalidAppKeyFailure',
    });
  });
});
