import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home.testkit.ts';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { useAppleStoreClientFactory } from '../services/stores/apple-store-client.ts';
import { isCommandExit } from '../terminal/command-exit.ts';
import type { AppStoreVersionResource, BuildResource } from '../types/apple-catalog.ts';
import type { AscReleaseApi } from './app-store-release.ts';
import { type StatusCommandFlags, statusCommandProgram } from './status-command.ts';

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

function outcomeOfFailure(failure: unknown): Omit<StatusRun, 'logLines'> {
  if (isCommandExit(failure)) {
    let failureMessage: string | null = null;

    if (failure.message != null) {
      failureMessage = failure.message;
    }

    return { exitCode: failure.exitCode, failureMessage };
  }

  return { exitCode: 1, failureMessage: errorMessage(failure) };
}

function promiseValue<Value>(value: Value): Promise<Value> {
  return Promise.resolve(value);
}

function makeReleaseApiFake(methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const baseApi = {
    getAppId: vi.fn(function readAppId() {
      return promiseValue('app1');
    }),
    getLatestMarketingVersion: vi.fn(function readMarketingVersion() {
      return promiseValue(null);
    }),
    listBuilds: vi.fn(function readBuilds() {
      return promiseValue([]);
    }),
    findBuild: vi.fn(function readBuild() {
      return promiseValue({ id: 'b-1', usesNonExemptEncryption: null });
    }),
    findBuildByVersion: vi.fn(function readBuildByVersion() {
      return promiseValue(null);
    }),
    setBuildUsesNonExemptEncryption: vi.fn(function setEncryption() {
      return promiseValue(undefined);
    }),
    listAppStoreVersions: vi.fn(function readVersions() {
      return promiseValue([liveVersion()]);
    }),
    createAppStoreVersion: vi.fn(function createVersion() {
      return promiseValue(liveVersion());
    }),
    updateAppStoreVersion: vi.fn(function updateVersion() {
      return promiseValue(undefined);
    }),
    selectBuildForVersion: vi.fn(function selectBuild() {
      return promiseValue(undefined);
    }),
    listAppStoreVersionLocalizations: vi.fn(function readLocalizations() {
      return promiseValue([]);
    }),
    createAppStoreVersionLocalization: vi.fn(function createLocalization() {
      return promiseValue({ id: 'loc-new', locale: 'en-US' });
    }),
    updateAppStoreVersionLocalization: vi.fn(function updateLocalization() {
      return promiseValue(undefined);
    }),
    getPhasedRelease: vi.fn(function readPhasedRelease() {
      return promiseValue(null);
    }),
    createPhasedRelease: vi.fn(function createPhasedRelease() {
      return promiseValue({ id: 'ph-new', phasedReleaseState: 'ACTIVE' });
    }),
    deletePhasedRelease: vi.fn(function deletePhasedRelease() {
      return promiseValue(undefined);
    }),
    listReviewSubmissions: vi.fn(function readReviews() {
      return promiseValue([]);
    }),
    createReviewSubmission: vi.fn(function createReview() {
      return promiseValue({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    }),
    addReviewSubmissionItem: vi.fn(function addReviewItem() {
      return promiseValue(undefined);
    }),
    submitReviewSubmission: vi.fn(function submitReview() {
      return promiseValue(undefined);
    }),
    getReviewSubmission: vi.fn(function readReview() {
      return promiseValue({ id: 'rs1', state: 'WAITING_FOR_REVIEW' });
    }),
    createAppStoreVersionReleaseRequest: vi.fn(function releaseVersion() {
      return promiseValue(undefined);
    }),
  } satisfies AscReleaseApi;
  return { ...baseApi, ...methodOverrides };
}

async function runStatusCommand(
  flags: StatusCommandFlags,
  appleReleaseApi: AscReleaseApi,
  appJsonText = APP_JSON_TEXT,
): Promise<StatusRun> {
  const homeDirectory = createTemporaryHomeDirectory();
  const logLines: string[] = [];

  try {
    const workDirectory = join(homeDirectory, 'work');
    mkdirSync(workDirectory, { recursive: true });
    writeFileSync(join(workDirectory, 'app.json'), appJsonText);
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE_TEXT);
    useLaunchDirectories({ homeDirectory, workingDirectory: workDirectory });
    useSecretStore(new Map([[`asc-p8:${ASC_KEY_ID}`, P8_SECRET]]));
    useLoggerSink(function writeLine(text: string) {
      logLines.push(text);
    });
    useAppleStoreClientFactory(function createClient() {
      return appleReleaseApi as ReturnType<
        typeof import('../services/stores/apple-store-client.ts').AppleStoreClientService.createClient
      >;
    });

    try {
      await statusCommandProgram(flags);
      return { exitCode: 0, failureMessage: null, logLines };
    } catch (failure) {
      return { ...outcomeOfFailure(failure), logLines };
    }
  } finally {
    resetLaunchDirectories();
    resetSecretStore();
    resetLogger();
    useAppleStoreClientFactory(null);
    removeTemporaryHomeDirectory(homeDirectory);
  }
}

afterEach(function resetStatusDoubles() {
  resetLaunchDirectories();
  resetSecretStore();
  resetLogger();
  useAppleStoreClientFactory(null);
});

describe('statusCommandProgram - plain status', () => {
  it('prints the status line and exits 0 when the version is live', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Promise.resolve([liveVersion()])),
    });

    const run = await runStatusCommand({}, api);

    expect(run.exitCode).toBe(0);
    expect(run.logLines.join('\n')).toContain('Live on the App Store');
  });

  it('annotates an attached build that is still processing', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() =>
        Promise.resolve([
          liveVersion({ appStoreState: 'IN_REVIEW', attachedBuildProcessingState: 'PROCESSING' }),
        ]),
      ),
    });

    const run = await runStatusCommand({}, api);

    expect(run.logLines.join('\n')).toContain('build 42 (PROCESSING)');
  });

  it('never lists builds without --builds', async () => {
    const listBuilds = vi.fn(() => Promise.resolve([makeBuild()]));
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Promise.resolve([liveVersion()])),
      listBuilds,
    });

    await runStatusCommand({}, api);

    expect(listBuilds).not.toHaveBeenCalled();
  });

  it('lists each recent build in its own row with --builds, looking up the app id once', async () => {
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(() => Promise.resolve([liveVersion()])),
      listBuilds: vi.fn(() =>
        Promise.resolve([
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
      listAppStoreVersions: vi.fn(() => Promise.resolve([liveVersion()])),
    });

    const run = await runStatusCommand({ watch: true }, api);

    expect(run.exitCode).toBe(0);
  });

  it('reports the build as ready once App Store Connect reports it VALID', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Promise.resolve(makeBuild({ processingState: 'VALID' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true }, api);

    expect(run.exitCode).toBe(0);
    expect(run.logLines.join('\n')).toContain('build 42 is VALID - ready to release');
  });

  it('fails with exit 1 when App Store Connect rejects the build', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Promise.resolve(makeBuild({ processingState: 'FAILED' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true }, api);

    expect(run.exitCode).toBe(1);
    expect(run.failureMessage).toMatch(/failed App Store Connect processing \(FAILED\)/);
  });

  it('prints ok true with the build under --json when the build is VALID', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Promise.resolve(makeBuild({ processingState: 'VALID' }))),
    });

    const run = await runStatusCommand({ build: '42', watch: true, json: true }, api);

    expect(run.logLines.join('\n')).toContain('"ok": true');
  });

  it('prints ok false with the error under --json when the build is rejected', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Promise.resolve(makeBuild({ processingState: 'INVALID' }))),
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
