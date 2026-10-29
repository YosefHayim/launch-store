import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient, makeFakePlayReportingClient } from '@testkit/storeClients.testkit.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import { discoverApps } from './discoverApps.js';

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

describe('discoverApps', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const discover = (credentials: Partial<StatsCredentialsShape>) =>
    Effect.runPromise(
      discoverApps().pipe(
        Effect.provide(makeStatsCredentialsTest(credentials)),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );

  test('lists the apps of every account and the Play account', async () => {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    const report = await discover({
      ascClientForAccount: (keyId) => {
        if (keyId === 'KEYA') {
          return Effect.succeed(makeFakeAscClient([{ id: '1', name: 'One', bundleId: 'com.one' }]));
        }
        return Effect.succeed(makeFakeAscClient([{ id: '2', name: 'Two', bundleId: null }]));
      },
      playReportingClient: () =>
        Effect.succeed(
          makeFakePlayReportingClient([{ packageName: 'com.play', displayName: 'Play' }]),
        ),
    });

    expect(report.apps.map((app) => [app.key, app.accountLabel])).toEqual([
      ['ios-1', 'alpha'],
      ['ios-2', 'beta'],
      ['android-com.play', 'google-play'],
    ]);
    expect(report).toMatchObject({
      warnings: [],
      attemptedSourceCount: 3,
      failedAccountLabels: [],
    });
    expect(report.apps[0]).toMatchObject({
      accountKeyId: 'KEYA',
      bundleId: 'com.one',
      packageName: null,
    });
    expect(report.apps[2]).toMatchObject({
      accountKeyId: null,
      packageName: 'com.play',
      platform: 'android',
    });
  });

  test('keeps the first account when two accounts see the same app', async () => {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
    const sharedApp = [{ id: '1', name: 'Shared', bundleId: 'com.shared' }];

    const report = await discover({
      ascClientForAccount: () => Effect.succeed(makeFakeAscClient(sharedApp)),
    });

    expect(report.apps.map((app) => app.accountLabel)).toEqual(['alpha']);
  });

  test('turns a failing account into a warning and still lists the others', async () => {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    const report = await discover({
      ascClientForAccount: (keyId) => {
        if (keyId === 'KEYA') return Effect.succeed(makeFakeAscClient(new Error('401 revoked')));
        return Effect.succeed(makeFakeAscClient([{ id: '2', name: 'Two', bundleId: null }]));
      },
    });

    expect(report.apps.map((app) => app.key)).toEqual(['ios-2']);
    expect(report.warnings).toEqual([{ accountLabel: 'alpha', message: '401 revoked' }]);
    expect(report.failedAccountLabels).toEqual(['alpha']);
    expect(report.attemptedSourceCount).toBe(2);
  });

  test('warns when an account has no saved key', async () => {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    const report = await discover({});

    expect(report.warnings.map((warning) => warning.accountLabel)).toEqual(['alpha', 'beta']);
    expect(report.warnings[0]?.message).toContain('no saved key');
  });

  test('turns a failing Play account into a warning', async () => {
    const report = await discover({
      playReportingClient: () =>
        Effect.succeed(makeFakePlayReportingClient(new Error('403 denied'))),
    });

    expect(report.warnings).toEqual([{ accountLabel: 'google-play', message: '403 denied' }]);
    expect(report.attemptedSourceCount).toBe(1);
  });

  test('does not count the Play source when no service account is saved', async () => {
    const report = await discover({});

    expect(report).toEqual({
      apps: [],
      warnings: [],
      attemptedSourceCount: 0,
      failedAccountLabels: [],
    });
  });
});
