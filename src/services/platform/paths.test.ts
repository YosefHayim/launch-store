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
} from './paths.js';

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
    expect(PROVISIONING_PROFILES_DIR).toContain(
      join('Library', 'MobileDevice', 'Provisioning Profiles'),
    );
  });
  it('creates directories through the file system', async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'launch-effect-paths-'));
    tempDirs.push(rootDirectory);
    const nestedDirectory = join(rootDirectory, 'a', 'b', 'c');
    await expect(ensureDirectoryExists(nestedDirectory)).resolves.toBe(nestedDirectory);
    expect(statSync(nestedDirectory).isDirectory()).toBe(true);
  });
  it('builds account paths from the home directory', () => {
    const accountDirectory = resolveAccountCredentialsDirectory('KEY/42');
    expect(accountDirectory).toBe(join(homedir(), '.launch', 'credentials', 'KEY42'));
  });
});

describe('stats paths', () => {
  const homeDirectory = '/test-home';

  function useTestHome(): void {
    useLaunchDirectories({ homeDirectory, workingDirectory: '/workspace' });
  }

  it('puts the stats folder and portfolio file under ~/.launch', () => {
    useTestHome();
    expect(locateStatsDirectory()).toBe(join(homeDirectory, '.launch', 'stats'));
    expect(locatePortfolioFilePath()).toBe(join(homeDirectory, '.launch', 'portfolio.json'));
  });

  it('puts the stats of one app in its own folder', () => {
    useTestHome();
    expect(locateAppStatsDirectory('android-com.acme.app')).toBe(
      join(homeDirectory, '.launch', 'stats', 'android-com.acme.app'),
    );
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
