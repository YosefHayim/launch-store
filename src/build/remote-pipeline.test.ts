import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { resetPrompts } from '../services/platform/prompt.ts';
import { registerBuildEngine } from '../services/provider-support/registry.ts';
import { prepareBuild, runBuild } from './pipeline.ts';
import { runEasBuild } from './expo-application-services-pipeline.ts';
// A dry-run must never shell out (no ssh/scp/rsync/aws) - make any spawn an immediate, obvious failure.
vi.mock('node:child_process', function mockChildProcess() {
  return {
    spawn: vi.fn(() => {
      throw new Error('spawn must not run during --dry-run');
    }),
  };
});

/** Run remote build-core tests with deterministic services and no CLI/provider bootstrap. */
async function runRemoteCoreTest<Success>(runCase: () => Promise<Success>): Promise<Success> {
  const hasTempRepo = tempRepo != '';

  if (hasTempRepo) {
    useLaunchDirectories({ homeDirectory: tempRepo, workingDirectory: tempRepo });
  }

  useLoggerSink(function keepLine(loggedLine: string): void {
    const isBlank = loggedLine == '';

    if (isBlank) {
      return;
    }
  });
  useLaunchEnvironment({});
  useSecretStore(new Map());
  resetPrompts();

  try {
    return await runCase();
  } finally {
    resetLaunchDirectories();
    resetLogger();
    resetLaunchEnvironment();
    resetPrompts();
    resetSecretStore();
  }
}

function mockCall() {
  throw new Error('fetch must not run during --dry-run');
}

/** Any network call during a dry-run is a bug - the rehearsal makes no AWS/Expo/account changes. */
const fetchGuard = vi.fn(mockCall);
let originalCwd = '';
let tempRepo = '';

function prepare() {
  originalCwd = process.cwd();
  fetchGuard.mockClear();
  vi.stubGlobal('fetch', fetchGuard);

  function mockImplementationPiece() {
    return undefined;
  }

  vi.spyOn(console, 'log').mockImplementation(mockImplementationPiece);

  function mockImplementationPiece2() {
    return undefined;
  }

  vi.spyOn(console, 'warn').mockImplementation(mockImplementationPiece2);

  function mockImplementationPiece3() {
    return undefined;
  }

  vi.spyOn(console, 'error').mockImplementation(mockImplementationPiece3);
  registerBuildEngine({
    name: 'xcode',
    async buildArtifact() {
      return {
        artifactPath: '(dry-run, not built)',
        sizeReport: { artifactBytes: 0, entries: [] },
        cleanBuilt: false,
      };
    },
  });
}

beforeEach(prepare);

function cleanup() {
  process.chdir(originalCwd);

  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = '';
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

afterEach(cleanup);

function writeRepo(): string {
  const systemTemporaryDirectory = tmpdir();
  const launchRemotePath = join(systemTemporaryDirectory, 'launch-remote-');
  const dir = mkdtempSync(launchRemotePath);
  const appPath = join(dir, 'app.json');
  const serialized = JSON.stringify({
    expo: { slug: 'hello', version: '1.0.0', ios: { bundleIdentifier: 'com.example.hello' } },
  });

  writeFileSync(appPath, serialized);

  return dir;
}
const base = {
  platform: 'ios' as const,
  profileName: 'production',
  appName: undefined,
  explain: false,
  submit: true,
  target: 'testing' as const,
  dryRun: true,
};

function describeRemoteBuildDryRunRehearsesWithNoSshNetwork() {
  async function rehearsesTheSSHByoRemotePath() {
    tempRepo = writeRepo();
    process.chdir(tempRepo);

    function runRemoteCoreTestPiece2() {
      return runBuild({ ...base, remote: { kind: 'ssh', target: 'ec2-user@1.2.3.4' } });
    }

    const remoteCoreTest = runRemoteCoreTest(runRemoteCoreTestPiece2);

    await expect(remoteCoreTest).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  }

  it('rehearses the SSH (byo) remote path', rehearsesTheSSHByoRemotePath);
}

describe(
  'remote build --dry-run rehearses with no SSH or network',
  describeRemoteBuildDryRunRehearsesWithNoSshNetwork,
);

function describeEASHandoffDryRunRehearsesWithNoEasCliNetwork() {
  async function rehearsesTheEASPath() {
    tempRepo = writeRepo();
    process.chdir(tempRepo);

    const remoteCoreTest = runRemoteCoreTest(async function rehearseEasBuild() {
      const preparedBuild = await prepareBuild(base);

      await runEasBuild(preparedBuild, base);
    });

    await expect(remoteCoreTest).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  }

  it('rehearses the EAS path', rehearsesTheEASPath);
}

describe(
  'EAS handoff --dry-run rehearses with no eas-cli/network',
  describeEASHandoffDryRunRehearsesWithNoEasCliNetwork,
);
