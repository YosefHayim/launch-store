import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { NodeHttpClient } from '@effect/platform-node';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import type { AppDescriptor } from '../types/app.js';
import { classifyVerdict, type ReleaseStatus } from './appStoreRelease.js';
import {
  formatStatusLine,
  selectIosApps,
  StatusCommandInputSchema,
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
  const appDescriptor: AppDescriptor = {
    name: appName,
    dir: `/repo/${appName}`,
    configPath: `/repo/${appName}/app.json`,
  };
  if (bundleId !== undefined) appDescriptor.bundleId = bundleId;
  return appDescriptor;
};

describe('StatusCommandInputSchema', () => {
  it('defaults to one read with human output', async () => {
    const commandInput = await Effect.runPromise(
      Schema.decodeUnknown(StatusCommandInputSchema)({}),
    );
    expect(commandInput).toEqual({ watch: false, json: false });
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

  it('handles an app with no App Store version yet', () => {
    expect(
      formatStatusLine(
        releaseStatus({ versionString: null, appStoreState: '', buildNumber: null }),
      ),
    ).toContain('no App Store version');
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
            buildEngine: 'fastlane',
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
