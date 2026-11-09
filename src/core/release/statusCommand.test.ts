import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeHttpClient } from '@effect/platform-node';
import { Effect, Layer, Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeReleaseApiFake } from '@testkit/ascReleaseApi.testkit.js';
import { makeFakeAscClient } from '@testkit/storeClients.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import { CommandExitSchema, type CommandExit } from '../terminal/commandExit.js';
import type { AppStoreVersionResource, BuildResource } from '../types/appleCatalog.js';
import type { AscReleaseApi } from './appStoreRelease.js';
import { type StatusCommandFlags, statusCommandProgram } from './statusCommand.js';

const ASC_KEY_ID = 'KEY123';
const P8_SECRET = Buffer.from('-----BEGIN PRIVATE KEY-----').toString('base64');
const ACCOUNTS_FILE_TEXT = JSON.stringify({
  active: ASC_KEY_ID,
  accounts: [
    {
      keyId: ASC_KEY_ID,
      issuerId: 'issuer-1',
      label: 'Owner',
      addedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
});
const APP_JSON_TEXT = JSON.stringify({
  expo: { name: 'Oly', version: '1.2.0', ios: { bundleIdentifier: 'com.acme.app' } },
});
const APP_JSON_WITHOUT_IOS_TEXT = JSON.stringify({ expo: { name: 'Oly', version: '1.2.0' } });

const liveVersion = (
  overrides: Partial<AppStoreVersionResource> = {},
): AppStoreVersionResource => ({
  id: 'v-1',
  versionString: '1.2.0',
  appStoreState: 'READY_FOR_SALE',
  attachedBuildNumber: '42',
  attachedBuildProcessingState: 'VALID',
  ...overrides,
});

const makeBuild = (overrides: Partial<BuildResource> = {}): BuildResource => ({
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
  ...overrides,
});

type StatusRun = Readonly<{
  exitCode: number;
  failureMessage: string | null;
  logLines: string[];
}>;

const isCommandExitFailure = (failure: unknown): failure is CommandExit =>
  Schema.is(CommandExitSchema)(failure);

const outcomeOfFailure = (failure: unknown): Omit<StatusRun, 'logLines'> => {
  if (isCommandExitFailure(failure)) {
    return { exitCode: failure.exitCode, failureMessage: failure.message ?? null };
  }
  return { exitCode: 1, failureMessage: errorMessage(failure) };
};

const runStatusCommand = async (
  flags: StatusCommandFlags,
  appleReleaseApi: AscReleaseApi,
  appJsonText = APP_JSON_TEXT,
): Promise<StatusRun> => {
  const homeDirectory = createTemporaryHomeDirectory();
  const logLines: string[] = [];

  try {
    const workDirectory = join(homeDirectory, 'work');
    mkdirSync(workDirectory, { recursive: true });
    writeFileSync(join(workDirectory, 'app.json'), appJsonText);
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE_TEXT);

    const appleStoreClientTest = Layer.succeed(AppleStoreClientService, {
      createClient: () => Effect.succeed(appleReleaseApi),
      createEffectClient: () => Effect.succeed(makeFakeAscClient([])),
      createReleaseAttributesClient: () => Effect.succeed(makeFakeAscClient([])),
    });
    const statusProgram = statusCommandProgram(flags).pipe(
      Effect.match({
        onSuccess: () => ({ exitCode: 0, failureMessage: null }),
        onFailure: outcomeOfFailure,
      }),
      Effect.provide(makeLaunchHomeTest(homeDirectory)),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(makeLaunchEnvironmentTest({})),
      Effect.provide(makeLaunchSecretStoreTest(new Map([[`asc-p8:${ASC_KEY_ID}`, P8_SECRET]]))),
      Effect.provide(makeLaunchLoggerTest(logLines)),
      Effect.provide(appleStoreClientTest),
    );

    const outcome = await Effect.runPromise(statusProgram);
    return { ...outcome, logLines };
  } finally {
    removeTemporaryHomeDirectory(homeDirectory);
  }
};

describe('statusCommandProgram - plain status', () => {
  it('prints the status line and exits 0 when the version is live', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Effect.succeed([liveVersion()])),
    });

    const run = await runStatusCommand({}, api);

    expect(run.exitCode).toBe(0);
    expect(run.logLines.join('\n')).toContain('Live on the App Store');
  });

  it('annotates an attached build that is still processing', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() =>
        Effect.succeed([
          liveVersion({ appStoreState: 'IN_REVIEW', attachedBuildProcessingState: 'PROCESSING' }),
        ]),
      ),
    });

    const run = await runStatusCommand({}, api);

    expect(run.logLines.join('\n')).toContain('build 42 (PROCESSING)');
  });

  it('never lists builds without --builds', async () => {
    const listBuilds = vi.fn(() => Effect.succeed([makeBuild()]));
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Effect.succeed([liveVersion()])),
      listBuilds,
    });

    await runStatusCommand({}, api);

    expect(listBuilds).not.toHaveBeenCalled();
  });

  it('lists each recent build in its own row with --builds, looking up the app id once', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Effect.succeed([liveVersion()])),
      listBuilds: vi.fn(() =>
        Effect.succeed([
          makeBuild({ id: 'b-43', version: '43', uploadedDate: '2026-11-03T10:00:00Z' }),
          makeBuild({ id: 'b-42', version: '42', uploadedDate: '2026-10-20T10:00:00Z' }),
        ]),
      ),
    });

    const run = await runStatusCommand({ builds: true }, api);

    const printedText = run.logLines.join('\n');
    expect(printedText).toContain('2026-11-03 10:00');
    expect(printedText).toContain('2026-10-20 10:00');
    expect(api.getAppId).toHaveBeenCalledTimes(1);
  });

  it('exits 0 with a note when the project has no iOS app', async () => {
    const api = makeReleaseApiFake();

    const run = await runStatusCommand({}, api, APP_JSON_WITHOUT_IOS_TEXT);

    expect(run.exitCode).toBe(0);
    expect(run.logLines.join('\n')).toContain('No iOS apps discovered');
  });

  it('fails with exit 1 on an --app name that is not an iOS app', async () => {
    const api = makeReleaseApiFake();

    const run = await runStatusCommand({ app: 'delta' }, api);

    expect(run.exitCode).toBe(1);
    expect(run.failureMessage).toMatch(/Unknown iOS app "delta"/);
  });
});

describe('statusCommandProgram - usage errors', () => {
  it('exits 2 when --build comes without --watch', async () => {
    const run = await runStatusCommand({ build: '42' }, makeReleaseApiFake());

    expect(run.exitCode).toBe(2);
    expect(run.failureMessage).toMatch(/--build needs --watch/);
  });

  it('exits 2 when --builds comes with --watch', async () => {
    const run = await runStatusCommand({ builds: true, watch: true }, makeReleaseApiFake());

    expect(run.exitCode).toBe(2);
    expect(run.failureMessage).toMatch(/--builds lists builds/);
  });

  it('exits 2 with the usage message for a --build that is not a whole number', async () => {
    const run = await runStatusCommand({ build: '4.5', watch: true }, makeReleaseApiFake());

    expect(run.exitCode).toBe(2);
    expect(run.failureMessage).toMatch(/--build takes a whole number above 0/);
  });

  it('exits 2 for a --build of 0', async () => {
    const run = await runStatusCommand({ build: '0', watch: true }, makeReleaseApiFake());

    expect(run.exitCode).toBe(2);
  });
});

describe('statusCommandProgram - --watch and --build', () => {
  it('exits with the verdict code when the first read is already terminal', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Effect.succeed([liveVersion()])),
    });

    const run = await runStatusCommand({ watch: true }, api);

    expect(run.exitCode).toBe(0);
  });

  it('reports the build as ready once App Store Connect reports it VALID', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'VALID' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true }, api);

    expect(run.exitCode).toBe(0);
    expect(run.logLines.join('\n')).toContain('build 42 is VALID - ready to release');
  });

  it('fails with exit 1 when App Store Connect rejects the build', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'FAILED' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true }, api);

    expect(run.exitCode).toBe(1);
    expect(run.failureMessage).toMatch(/failed App Store Connect processing \(FAILED\)/);
  });

  it('prints ok true with the build under --json when the build is VALID', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'VALID' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true, json: true }, api);

    expect(run.logLines.join('\n')).toContain('"ok": true');
  });

  it('prints ok false with the error under --json when the build is rejected', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'INVALID' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true, json: true }, api);

    expect(run.exitCode).toBe(1);
    expect(run.logLines.join('\n')).toContain('"ok": false');
  });

  it('fails with exit 1 and a clear message when --build has no iOS app to watch', async () => {
    const run = await runStatusCommand(
      { build: '42', watch: true },
      makeReleaseApiFake(),
      APP_JSON_WITHOUT_IOS_TEXT,
    );

    expect(run.exitCode).toBe(1);
    expect(run.failureMessage).toMatch(/No iOS apps discovered/);
  });
});
