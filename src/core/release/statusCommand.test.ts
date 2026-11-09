import { Effect, Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { NodeHttpClient } from '@effect/platform-node';
import { makeReleaseApiFake } from '@testkit/ascReleaseApi.testkit.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildResource } from '../types/appleCatalog.js';
import { type AscReleaseApi, classifyVerdict, type ReleaseStatus } from './appStoreRelease.js';
import type { MutableDeep } from '../types/mutable.js';
import {
  findStatusUsageProblem,
  formatRecentBuilds,
  formatStatusLine,
  readRecentBuilds,
  selectIosApps,
  type StatusCommandInput,
  StatusCommandInputSchema,
  watchBuildProcessing,
  watchReleaseStatuses,
  worstExitCode,
} from './statusCommand.js';

const releaseStatus = (overrides: Partial<ReleaseStatus> = {}): ReleaseStatus => {
  const baseStatus: ReleaseStatus = {
    bundleId: 'com.acme.app',
    versionString: '1.2.0',
    appStoreState: 'IN_REVIEW',
    buildNumber: '42',
    buildProcessingState: 'VALID',
    phasedReleaseState: null,
    verdict: classifyVerdict('IN_REVIEW'),
  };
  const mergedStatus: ReleaseStatus = { ...baseStatus, ...overrides };
  if (overrides.appStoreState !== undefined && overrides.verdict === undefined) {
    let appStoreState = overrides.appStoreState;
    if (appStoreState === null) appStoreState = '';
    mergedStatus.verdict = classifyVerdict(appStoreState);
  }
  return mergedStatus;
};

const discoveredApp = (appName: string, bundleId?: string): AppDescriptor => {
  const appDescriptor: MutableDeep<AppDescriptor> = {
    name: appName,
    dir: `/repo/${appName}`,
    configPath: `/repo/${appName}/app.json`,
  };
  if (bundleId !== undefined) appDescriptor.bundleId = bundleId;
  return appDescriptor;
};

const makeBuild = (overrides: Partial<BuildResource> = {}): BuildResource => ({
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
  ...overrides,
});

const plainInput: StatusCommandInput = { watch: false, json: false, builds: false };

describe('StatusCommandInputSchema', () => {
  it('defaults to one read with human output and no build list', async () => {
    const commandInput = await Effect.runPromise(
      Schema.decodeUnknown(StatusCommandInputSchema)({}),
    );
    expect(commandInput).toEqual({ watch: false, json: false, builds: false });
  });

  it('reads --build text as a whole build number', async () => {
    const commandInput = await Effect.runPromise(
      Schema.decodeUnknown(StatusCommandInputSchema)({ build: '42', watch: true }),
    );
    expect(commandInput.build).toBe(42);
  });

  it('rejects a --build that is not a whole number', async () => {
    await expect(
      Effect.runPromise(Schema.decodeUnknown(StatusCommandInputSchema)({ build: '4.5' })),
    ).rejects.toThrow();
  });
});

describe('formatStatusLine', () => {
  it('renders version, verdict, build, and phased state', () => {
    expect(formatStatusLine(releaseStatus())).toBe('v1.2.0 - In review - build 42');
  });

  it('annotates a build still processing', () => {
    expect(formatStatusLine(releaseStatus({ buildProcessingState: 'PROCESSING' }))).toContain(
      'build 42 (PROCESSING)',
    );
  });

  it('shows the phased-rollout state and a live verdict', () => {
    const statusLine = formatStatusLine(
      releaseStatus({ appStoreState: 'READY_FOR_SALE', phasedReleaseState: 'ACTIVE' }),
    );
    expect(statusLine).toContain('Live on the App Store');
    expect(statusLine).toContain('phased: ACTIVE');
  });

  it('shows no build when the version has none attached', () => {
    expect(
      formatStatusLine(releaseStatus({ buildNumber: null, buildProcessingState: null })),
    ).toBe('v1.2.0 - In review - no build');
  });

  it('handles an app with no App Store version yet', () => {
    expect(
      formatStatusLine(
        releaseStatus({ versionString: null, appStoreState: '', buildNumber: null }),
      ),
    ).toContain('no App Store version');
  });
});

describe('formatRecentBuilds', () => {
  it('says so when the app has no uploaded builds', () => {
    expect(formatRecentBuilds([])).toBe('  no builds uploaded yet');
  });

  it('shows one build with its version, processing state, and UTC upload time', () => {
    const table = formatRecentBuilds([
      makeBuild({
        version: '42',
        marketingVersion: '1.2.0',
        uploadedDate: '2026-11-01T09:30:00Z',
      }),
    ]);
    expect(table).toContain('UPLOADED (UTC)');
    expect(table).toContain('1.2.0');
    expect(table).toContain('VALID');
    expect(table).toContain('2026-11-01 09:30');
  });

  it('lists every build it is given, one row each', () => {
    const table = formatRecentBuilds([
      makeBuild({ id: 'b-43', version: '43' }),
      makeBuild({ id: 'b-42', version: '42' }),
    ]);
    expect(table).toContain('43');
    expect(table).toContain('42');
  });
});

describe('readRecentBuilds', () => {
  const selectedApp = { name: 'alpha', bundleId: 'com.acme.alpha' };

  it('returns the builds newest upload first', async () => {
    const api = makeReleaseApiFake({
      listBuilds: vi.fn(() =>
        Effect.succeed([
          makeBuild({ version: '41', uploadedDate: '2026-10-01T10:00:00Z' }),
          makeBuild({ version: '43', uploadedDate: '2026-11-03T10:00:00Z' }),
          makeBuild({ version: '42', uploadedDate: '2026-10-20T10:00:00Z' }),
        ]),
      ),
    });
    const recentBuilds = await Effect.runPromise(readRecentBuilds(api, selectedApp));
    expect(recentBuilds.map((build) => build.version)).toEqual(['43', '42', '41']);
  });

  it('fails with the app record message when App Store Connect has no app for the bundle id', async () => {
    const api = makeReleaseApiFake({ getAppId: vi.fn(() => Effect.succeed(null)) });
    await expect(Effect.runPromise(readRecentBuilds(api, selectedApp))).rejects.toThrow(
      /No App Store Connect app record for com\.acme\.alpha/,
    );
  });
});

describe('watchBuildProcessing', () => {
  const selectedApp = { name: 'alpha', bundleId: 'com.acme.alpha' };

  const watchBuild = (
    appleClient: AscReleaseApi,
    terminalWrites: string[],
    pollOptions: { timeoutMs?: number } = {},
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        return yield* watchBuildProcessing(
          { appleClient, selectedApp, buildNumber: 42, logger, isJson: false },
          { sleep: () => Effect.void, intervalMs: 1, ...pollOptions },
        );
      }).pipe(
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(NodeHttpClient.layer),
      ),
    );

  it('returns the build once App Store Connect reports it VALID, and prints the state', async () => {
    const terminalWrites: string[] = [];
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'VALID' }))),
    });
    const storeBuild = await watchBuild(api, terminalWrites);
    expect(storeBuild.version).toBe('42');
    expect(terminalWrites.join('')).toContain('build 42 is VALID');
  });

  it('waits through PROCESSING and prints each state it sees', async () => {
    const terminalWrites: string[] = [];
    const findBuildByVersion = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed(makeBuild({ processingState: 'PROCESSING' })))
      .mockReturnValueOnce(Effect.succeed(makeBuild({ processingState: 'VALID' })));
    const api = makeReleaseApiFake({ findBuildByVersion });
    await watchBuild(api, terminalWrites);
    expect(terminalWrites.join('')).toContain('build 42 is PROCESSING');
    expect(terminalWrites.join('')).toContain('build 42 is VALID');
  });

  it('fails on FAILED processing', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'FAILED' }))),
    });
    await expect(watchBuild(api, [])).rejects.toThrow(/FAILED/);
  });

  it('fails on INVALID processing', async () => {
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(() => Effect.succeed(makeBuild({ processingState: 'INVALID' }))),
    });
    await expect(watchBuild(api, [])).rejects.toThrow(/INVALID/);
  });

  it('fails with the not-found message when the build never appears before the timeout', async () => {
    const api = makeReleaseApiFake({ findBuildByVersion: vi.fn(() => Effect.succeed(null)) });
    await expect(watchBuild(api, [], { timeoutMs: 0 })).rejects.toThrow(
      /was not found on App Store Connect/,
    );
  });
});

describe('findStatusUsageProblem', () => {
  const oneApp = [{ name: 'alpha', bundleId: 'com.acme.alpha' }];
  const twoApps = [...oneApp, { name: 'beta', bundleId: 'com.acme.beta' }];

  it('returns null when the flags fit together', () => {
    expect(findStatusUsageProblem(plainInput, oneApp)).toBeNull();
    expect(findStatusUsageProblem({ ...plainInput, watch: true, build: 42 }, oneApp)).toBeNull();
  });

  it('asks for --watch when --build is given without it', () => {
    expect(findStatusUsageProblem({ ...plainInput, build: 42 }, oneApp)).toMatch(/needs --watch/);
  });

  it('rejects --builds combined with --watch', () => {
    expect(findStatusUsageProblem({ ...plainInput, watch: true, builds: true }, oneApp)).toMatch(
      /--builds lists/,
    );
  });

  it('asks for one --app when --build is given for several apps', () => {
    expect(findStatusUsageProblem({ ...plainInput, watch: true, build: 42 }, twoApps)).toMatch(
      /pass --app/,
    );
  });
});

describe('worstExitCode - error > rejected > in-progress > ok', () => {
  it('picks the worst code in the batch', () => {
    expect(worstExitCode([0, 0])).toBe(0);
    expect(worstExitCode([0, 3])).toBe(3);
    expect(worstExitCode([3, 2])).toBe(2);
    expect(worstExitCode([2, 1])).toBe(1);
    expect(worstExitCode([0, 1, 3])).toBe(1);
    expect(worstExitCode([])).toBe(0);
  });
});

describe('selectIosApps', () => {
  const apps = [
    discoveredApp('alpha', 'com.acme.alpha'),
    discoveredApp('beta'),
    discoveredApp('gamma', 'com.acme.gamma'),
  ];

  it('returns every app with a bundle id when no selector is given', async () => {
    expect(await Effect.runPromise(selectIosApps(apps, undefined))).toEqual([
      { name: 'alpha', bundleId: 'com.acme.alpha' },
      { name: 'gamma', bundleId: 'com.acme.gamma' },
    ]);
  });

  it('narrows to the named apps', async () => {
    expect(await Effect.runPromise(selectIosApps(apps, 'gamma'))).toEqual([
      { name: 'gamma', bundleId: 'com.acme.gamma' },
    ]);
  });

  it('fails on an unknown app name', async () => {
    await expect(Effect.runPromise(selectIosApps(apps, 'delta'))).rejects.toThrow(
      /Unknown iOS app/,
    );
  });
});

describe('watchReleaseStatuses', () => {
  it('polls until the verdict is terminal and returns its exit code', async () => {
    let readCount = 0;
    const terminalWrites: string[] = [];
    const exitCode = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        return yield* watchReleaseStatuses(
          () => {
            readCount += 1;
            let appStoreState = 'IN_REVIEW';
            if (readCount > 1) appStoreState = 'READY_FOR_SALE';
            return Effect.succeed([
              {
                appName: 'alpha',
                releaseStatus: releaseStatus({ appStoreState }),
              },
            ]);
          },
          logger,
          {
            credentials: 'local',
            storage: 'local',
            buildEngine: 'xcode',
            submit: 'app-store-connect',
            profiles: {},
          },
          () => Effect.void,
        );
      }).pipe(
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(NodeHttpClient.layer),
      ),
    );
    expect(readCount).toBe(2);
    expect(exitCode).toBe(0);
    expect(terminalWrites.join('')).toContain('In review');
    expect(terminalWrites.join('')).toContain('Live on the App Store');
  });
});
