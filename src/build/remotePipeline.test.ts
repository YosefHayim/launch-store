import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetSecretStore, useSecretStore } from '../services/credentials/secretStore.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { resetPrompts } from '../services/platform/prompt.ts';
import { registerBuildEngine } from '../services/providerSupport/registry.ts';
import { prepareBuild, runBuild } from './pipeline.ts';
import { runEasBuild } from './easPipeline.ts';
// A dry-run must never shell out (no ssh/scp/rsync/aws) - make any spawn an immediate, obvious failure.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('spawn must not run during --dry-run');
  }),
}));

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
    name: 'xcode',
    buildArtifact: async () => ({
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
      runRemoteCoreTest(() => runBuild({ ...base, remote: { kind: 'aws' } })),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
  it('rehearses the SSH (byo) remote path', async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(
      runRemoteCoreTest(() =>
        runBuild({ ...base, remote: { kind: 'ssh', target: 'ec2-user@1.2.3.4' } }),
      ),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
describe('EAS handoff --dry-run rehearses with no eas-cli/network', () => {
  it('rehearses the EAS path', async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(
      runRemoteCoreTest(async function rehearseEasBuild() {
        const preparedBuild = await prepareBuild(base);

        await runEasBuild(preparedBuild, base);
      }),
    ).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
