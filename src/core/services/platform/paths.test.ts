import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectDefined } from '@testkit/assertions.testkit.js';
import {
  ARTIFACTS_DIR,
  ARTIFACT_INDEX,
  CREDENTIALS_DIR,
  CREDENTIALS_INDEX,
  PROVISIONING_PROFILES_DIR,
  LAUNCH_HOME,
  ensureDirectoryExists,
  locateAppStatsDirectory,
  locatePortfolioFilePath,
  locateStatsDirectory,
  makeLaunchPathsTest,
  resolveAccountCredentialsDirectory,
  type LaunchPathsService,
} from './paths.js';
/** Execute a path service test with the official Node platform services. */
const executeTestProgram = <TValue, TError>(
  program: Effect.Effect<TValue, TError, LaunchPathsService | NodeContext.NodeContext>,
): Promise<TValue> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(homedir(), process.cwd())),
    ),
  );
const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(expectDefined(tempDirs.pop(), 'temp dir'), { recursive: true, force: true });
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
  it('creates directories through Effect Platform FileSystem', async () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), 'launch-effect-paths-'));
    tempDirs.push(rootDirectory);
    const nestedDirectory = join(rootDirectory, 'a', 'b', 'c');
    await expect(executeTestProgram(ensureDirectoryExists(nestedDirectory))).resolves.toBe(
      nestedDirectory,
    );
    expect(statSync(nestedDirectory).isDirectory()).toBe(true);
  });
  it('builds account paths through Effect Platform Path', async () => {
    const accountDirectory = await executeTestProgram(resolveAccountCredentialsDirectory('KEY/42'));
    expect(accountDirectory).toBe(join(CREDENTIALS_DIR, 'KEY42'));
  });
});
describe('stats paths', () => {
  const homeDirectory = join('/test-home');
  const runWithHome = <Success, Failure>(
    program: Effect.Effect<Success, Failure, LaunchPathsService | NodeContext.NodeContext>,
  ) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(makeLaunchPathsTest(homeDirectory, '/workspace')),
      ),
    );

  it('puts the stats folder and portfolio file under ~/.launch', async () => {
    expect(await runWithHome(locateStatsDirectory())).toBe(join(homeDirectory, '.launch', 'stats'));
    expect(await runWithHome(locatePortfolioFilePath())).toBe(
      join(homeDirectory, '.launch', 'portfolio.json'),
    );
  });

  it('puts the stats of one app in its own folder', async () => {
    const appDirectory = await runWithHome(locateAppStatsDirectory('android-com.acme.app'));

    expect(appDirectory).toBe(join(homeDirectory, '.launch', 'stats', 'android-com.acme.app'));
  });

  it('refuses an app key that could leave the stats folder', async () => {
    await expect(runWithHome(locateAppStatsDirectory('ios-../../etc'))).rejects.toThrow(
      'not a valid app key',
    );
  });
});
