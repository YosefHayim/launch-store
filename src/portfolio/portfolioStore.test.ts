import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launchHome.testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import {
  createEmptyPortfolioFile,
  loadPortfolioFile,
  pickSavedPortfolioFile,
  savePortfolioFile,
} from './portfolioStore.ts';

let homeDirectory: string;

beforeEach(function setPortfolioHome() {
  homeDirectory = createTemporaryHomeDirectory();
  useLaunchDirectories({
    homeDirectory,
    workingDirectory: join(homeDirectory, 'work'),
  });
});

afterEach(function resetPortfolioHome() {
  resetLaunchDirectories();
  removeTemporaryHomeDirectory(homeDirectory);
});

const savedFile: PortfolioFile = {
  version: 1,
  discoveredAt: '2026-10-29T10:00:00.000Z',
  apps: [
    {
      key: 'ios-1',
      platform: 'ios',
      storeId: '1',
      name: 'Cal Friend AI',
      bundleId: 'com.jts.calfriend',
      packageName: null,
      accountKeyId: 'KEY1',
      accountLabel: 'yosef',
    },
  ],
  tags: [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: '99' }],
  playReportsBucket: null,
};

describe('createEmptyPortfolioFile', () => {
  test('has no apps, no tags and no discovery time', () => {
    expect(createEmptyPortfolioFile()).toEqual({
      version: 1,
      discoveredAt: null,
      apps: [],
      tags: [],
      playReportsBucket: null,
    });
  });
});

describe('loadPortfolioFile', () => {
  test('returns null when portfolio.json does not exist', async () => {
    const loaded = await loadPortfolioFile();

    expect(loaded).toBeNull();
  });

  test('decodes a file without playReportsBucket as null', async () => {
    writeLaunchHomeFile(
      homeDirectory,
      'portfolio.json',
      '{"version":1,"discoveredAt":null,"apps":[],"tags":[]}',
    );

    const loaded = await loadPortfolioFile();

    expect(loaded?.playReportsBucket).toBeNull();
  });

  test('fails when portfolio.json is broken', async () => {
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', '{"version":2}');

    await expect(loadPortfolioFile()).rejects.toMatchObject({ _tag: 'DocumentFileFailure' });
  });
});

describe('savePortfolioFile', () => {
  test('writes portfolio.json under ~/.launch and reads it back the same', async () => {
    await savePortfolioFile(savedFile);
    const loaded = await loadPortfolioFile();

    expect(loaded).toEqual(savedFile);
    const savedFileText = readFileSync(join(homeDirectory, '.launch', 'portfolio.json'), 'utf8');
    expect(JSON.parse(savedFileText)).toEqual(savedFile);
  });
});

describe('pickSavedPortfolioFile', () => {
  test('returns an empty portfolio when nothing was saved', () => {
    expect(pickSavedPortfolioFile(null)).toEqual(createEmptyPortfolioFile());
  });

  test('returns the saved portfolio as it is', () => {
    const cachedFile = { ...createEmptyPortfolioFile(), discoveredAt: '2026-10-29T10:00:00.000Z' };

    expect(pickSavedPortfolioFile(cachedFile)).toBe(cachedFile);
  });
});
