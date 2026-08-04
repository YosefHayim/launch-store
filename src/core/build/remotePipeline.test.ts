import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A dry-run must never shell out (no ssh/scp/rsync/aws) - make any spawn an immediate, obvious failure.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('spawn must not run during --dry-run');
  }),
}));
import { AppleCredentialsClientLive } from '../services/appleCredentialsClient.js';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { AppStoreIdentityLive } from '../services/appStoreIdentity.js';
import { LaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { registerBuildEngine } from '../services/registry.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import { prepareBuild, runBuild } from './pipeline.js';
import { runEasBuild } from './easPipeline.js';

/** Run remote build-core tests with deterministic services and no CLI/provider bootstrap. */
type RemoteCoreTestRequirements =
  | Effect.Effect.Context<ReturnType<typeof runBuild>>
  | Effect.Effect.Context<ReturnType<typeof prepareBuild>>
  | Effect.Effect.Context<ReturnType<typeof runEasBuild>>;
const runRemoteCoreTest = <Success, Failure>(
  program: Effect.Effect<Success, Failure, RemoteCoreTestRequirements>,
): Promise<Success> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
      Effect.provide(AppleStoreClientLive),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(makeLaunchPathsTest(tempRepo, tempRepo)),
      Effect.provide(makeLaunchPromptTest()),
      Effect.provide(makeLaunchSecretStoreTest()),
      Effect.provide(makeLaunchLoggerTest([])),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
    ),
  );
/** Any network call during a dry-run is a bug - the rehearsal makes no AWS/Expo/account changes. */
const fetchGuard = vi.fn(() => {
  throw new Error('fetch must not run during --dry-run');
});
let originalCwd = '';
let tempRepo = '';
beforeEach(() => {
  originalCwd = process.cwd();
  fetchGuard.mockClear();
  vi.stubGlobal('fetch', fetchGuard);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  registerBuildEngine({
    name: 'fastlane',
    buildArtifact: () =>
      Effect.succeed({
        artifactPath: '(dry-run, not built)',
        sizeReport: { artifactBytes: 0, entries: [] },
        cleanBuilt: false,
      }),
  });
});
afterEach(() => {
  process.chdir(originalCwd);
  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = '';
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const writeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-remote-'));
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({
      expo: { slug: 'hello', version: '1.0.0', ios: { bundleIdentifier: 'com.example.hello' } },
    }),
  );
  return dir;
};
const base = {
  platform: 'ios' as const,
  profileName: 'production',
  appName: undefined,
  explain: false,
  submit: true,
  target: 'testing' as const,
  dryRun: true,
};
describe('remote build --dry-run rehearses with no SSH/AWS/network', () => {
  it('rehearses the AWS remote path', async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(
      runRemoteCoreTest(runBuild({ ...base, remote: { kind: 'aws' } })),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
  it('rehearses the SSH (byo) remote path', async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(
      runRemoteCoreTest(runBuild({ ...base, remote: { kind: 'ssh', target: 'ec2-user@1.2.3.4' } })),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
describe('EAS handoff --dry-run rehearses with no eas-cli/network', () => {
  it('rehearses the EAS path', async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(
      runRemoteCoreTest(
        prepareBuild(base).pipe(
          Effect.flatMap((preparedBuild) => runEasBuild(preparedBuild, base)),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
