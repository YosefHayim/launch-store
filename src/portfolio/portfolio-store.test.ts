import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { PortfolioFile } from '../types/portfolio.ts';
import {
  createEmptyPortfolioFile,
  loadPortfolioFile,
  pickSavedPortfolioFile,
  savePortfolioFile,
} from './portfolio-store.ts';

let homeDirectory: string;

beforeEach(function setPortfolioHome() {
  homeDirectory = createTemporaryHomeDirectory();
  const workPath = join(homeDirectory, 'work');
  useLaunchDirectories({
    homeDirectory,
    workingDirectory: workPath,
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
    const emptyPortfolioFile = createEmptyPortfolioFile();
    expect(emptyPortfolioFile).toEqual({
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

    const portfolioFile = loadPortfolioFile();
    await expect(portfolioFile).rejects.toMatchObject({ _tag: 'DocumentFileFailure' });
  });
});

describe('savePortfolioFile', () => {
  test('writes portfolio.json under ~/.launch and reads it back the same', async () => {
    await savePortfolioFile(savedFile);
    const loaded = await loadPortfolioFile();

    expect(loaded).toEqual(savedFile);
    const portfolioPath = join(homeDirectory, '.launch', 'portfolio.json');
    const savedFileText = readFileSync(portfolioPath, 'utf8');
    const parsed = JSON.parse(savedFileText);
    expect(parsed).toEqual(savedFile);
  });
});

describe('pickSavedPortfolioFile', () => {
  test('returns an empty portfolio when nothing was saved', () => {
    const savedPortfolioFile = pickSavedPortfolioFile(null);
    const emptyPortfolioFile = createEmptyPortfolioFile();
    expect(savedPortfolioFile).toEqual(emptyPortfolioFile);
  });

  test('returns the saved portfolio as it is', () => {
    const cachedFile = { ...createEmptyPortfolioFile(), discoveredAt: '2026-10-29T10:00:00.000Z' };

    const savedPortfolioFile = pickSavedPortfolioFile(cachedFile);
    expect(savedPortfolioFile).toBe(cachedFile);
  });
});
