import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACTS_DIR,
  ARTIFACT_INDEX,
  CREDENTIALS_DIR,
  CREDENTIALS_INDEX,
  LAUNCH_HOME,
  PROVISIONING_PROFILES_DIR,
  ensureDirectoryExists,
  locateAppStatsDirectory,
  locatePortfolioFilePath,
  locateStatsDirectory,
  resetLaunchDirectories,
  resolveAccountCredentialsDirectory,
  useLaunchDirectories,
} from './paths.ts';

const tempDirs: string[] = [];

afterEach(function removeTempDirectories() {
  resetLaunchDirectories();

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory == null) {
      return;
    }

    rmSync(directory, { recursive: true, force: true });
  }
});

describe('paths - one canonical layout for ~/.launch', () => {
  it('nests all local state under ~/.launch', () => {
    expect(LAUNCH_HOME.endsWith('.launch')).toBe(true);
    expect(ARTIFACTS_DIR.startsWith(LAUNCH_HOME)).toBe(true);
    expect(ARTIFACT_INDEX.startsWith(ARTIFACTS_DIR)).toBe(true);
    expect(CREDENTIALS_INDEX.startsWith(CREDENTIALS_DIR)).toBe(true);
  });
  it('points the profile install dir at where Xcode looks', () => {
    const provisioningProfilesPath = join('Library', 'MobileDevice', 'Provisioning Profiles');
    expect(PROVISIONING_PROFILES_DIR).toContain(provisioningProfilesPath);
  });
  it('creates directories through the file system', async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchEffectPathsPath = join(systemTemporaryDirectory, 'launch-effect-paths-');
    const rootDirectory = mkdtempSync(launchEffectPathsPath);
    tempDirs.push(rootDirectory);
    const nestedDirectory = join(rootDirectory, 'a', 'b', 'c');
    const directoryExists = ensureDirectoryExists(nestedDirectory);
    await expect(directoryExists).resolves.toBe(nestedDirectory);
    expect(statSync(nestedDirectory).isDirectory()).toBe(true);
  });
  it('builds account paths from the home directory', () => {
    const accountDirectory = resolveAccountCredentialsDirectory('KEY/42');
    const homeDirectory = homedir();
    const key42Path = join(homeDirectory, '.launch', 'credentials', 'KEY42');
    expect(accountDirectory).toBe(key42Path);
  });
});

describe('stats paths', () => {
  const homeDirectory = '/test-home';

  function useTestHome(): void {
    useLaunchDirectories({ homeDirectory, workingDirectory: '/workspace' });
  }

  it('puts the stats folder and portfolio file under ~/.launch', () => {
    useTestHome();
    const statsDirectory = locateStatsDirectory();
    const statsPath = join(homeDirectory, '.launch', 'stats');
    expect(statsDirectory).toBe(statsPath);
    const portfolioFilePath = locatePortfolioFilePath();
    const portfolioPath = join(homeDirectory, '.launch', 'portfolio.json');
    expect(portfolioFilePath).toBe(portfolioPath);
  });

  it('puts the stats of one app in its own folder', () => {
    useTestHome();
    const appStatsDirectory = locateAppStatsDirectory('android-com.acme.app');
    const androidComPath = join(homeDirectory, '.launch', 'stats', 'android-com.acme.app');
    expect(appStatsDirectory).toBe(androidComPath);
  });

  it('refuses an app key that could leave the stats folder', () => {
    useTestHome();
    let failure: unknown = null;

    try {
      locateAppStatsDirectory('ios-../../etc');
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({
      _tag: 'InvalidAppKeyFailure',
      message: expect.stringContaining('not a valid app key'),
    });
  });
});
