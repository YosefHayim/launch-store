import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import {
  makeStatsCredentialsTest,
  useStatsCredentials,
  type AppStoreStatsClient,
  type PlayVitalsReader,
} from '../stats/stats-credentials.ts';
import { discoverApps } from './discover-apps.ts';
import type { DiscoveredApp, DiscoveryWarning } from '../types/portfolio.ts';

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

interface FakeAscApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

interface FakePlayApp {
  readonly packageName: string;
  readonly displayName: string;
}

function makeAscClient(appsOrFailure: readonly FakeAscApp[] | Error): AppStoreStatsClient {
  const client = {
    async listApps() {
      if (appsOrFailure instanceof Error) {
        throw appsOrFailure;
      }

      return appsOrFailure;
    },
  };

  return client as unknown as AppStoreStatsClient;
}

function makePlayClient(appsOrFailure: readonly FakePlayApp[] | Error): PlayVitalsReader {
  const client = {
    async listApps() {
      if (appsOrFailure instanceof Error) {
        throw appsOrFailure;
      }

      return appsOrFailure;
    },
  };

  return client as unknown as PlayVitalsReader;
}
function describeDiscoverApps() {
  let homeDirectory: string;

  beforeEach(function setDiscoverHome() {
    homeDirectory = createTemporaryHomeDirectory();

    const project = join(homeDirectory, 'work');

    mkdirSync(project, { recursive: true });

    const appPath = join(project, 'app.json');
    const serialized = JSON.stringify({
      expo: { name: 'Play', slug: 'play', android: { package: 'com.play' } },
    });

    writeFileSync(appPath, serialized);
    useLaunchDirectories({ homeDirectory, workingDirectory: project });
  });

  afterEach(function resetDiscoverHome() {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  async function listsTheAppsOfEveryAccountAndThePlayAccount() {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    async function ascClientForAccount(keyId: string): Promise<AppStoreStatsClient | null> {
      if (keyId == 'KEYA') {
        return makeAscClient([{ id: '1', name: 'One', bundleId: 'com.one' }]);
      }

      return makeAscClient([{ id: '2', name: 'Two', bundleId: null }]);
    }

    async function playReportingClient(): Promise<PlayVitalsReader | null> {
      return makePlayClient([{ packageName: 'com.play', displayName: 'Play' }]);
    }

    makeStatsCredentialsTest({ ascClientForAccount, playReportingClient });

    const report = await discoverApps();

    function listAppKeyAndAccount(app: DiscoveredApp) {
      return [app.key, app.accountLabel];
    }

    expect(report.apps.map(listAppKeyAndAccount)).toEqual([
      ['ios-1', 'alpha'],
      ['ios-2', 'beta'],
      ['android-com.play', 'google-play'],
    ]);
    expect(report).toMatchObject({
      warnings: [],
      attemptedAccountCount: 3,
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
  }

  test(
    'lists the apps of every account and the Play account',
    listsTheAppsOfEveryAccountAndThePlayAccount,
  );

  async function keepsTheFirstAccountWhenTwoAccountsSeeTheSameApp() {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    const sharedApp = [{ id: '1', name: 'Shared', bundleId: 'com.shared' }];

    async function ascClientForAccount(): Promise<AppStoreStatsClient | null> {
      return makeAscClient(sharedApp);
    }

    makeStatsCredentialsTest({ ascClientForAccount });

    const report = await discoverApps();

    function readAccountLabel(app: DiscoveredApp) {
      return app.accountLabel;
    }

    expect(report.apps.map(readAccountLabel)).toEqual(['alpha']);
  }

  test(
    'keeps the first account when two accounts see the same app',
    keepsTheFirstAccountWhenTwoAccountsSeeTheSameApp,
  );

  async function turnsAFailingAccountIntoAWarningAndStillListsTheOthers() {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);

    async function ascClientForAccount(keyId: string): Promise<AppStoreStatsClient | null> {
      if (keyId == 'KEYA') {
        return makeAscClient(new Error('401 revoked'));
      }

      return makeAscClient([{ id: '2', name: 'Two', bundleId: null }]);
    }

    makeStatsCredentialsTest({ ascClientForAccount });

    const report = await discoverApps();

    function readKey(app: DiscoveredApp) {
      return app.key;
    }

    expect(report.apps.map(readKey)).toEqual(['ios-2']);
    expect(report.warnings).toEqual([{ accountLabel: 'alpha', message: '401 revoked' }]);
    expect(report.failedAccountLabels).toEqual(['alpha']);
    expect(report.attemptedAccountCount).toBe(2);
  }

  test(
    'turns a failing account into a warning and still lists the others',
    turnsAFailingAccountIntoAWarningAndStillListsTheOthers,
  );

  async function warnsWhenAnAccountHasNoSavedKey() {
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
    makeStatsCredentialsTest();

    const report = await discoverApps();

    function readAccountLabel2(warning: DiscoveryWarning) {
      return warning.accountLabel;
    }

    expect(report.warnings.map(readAccountLabel2)).toEqual(['alpha', 'beta']);
    expect(report.warnings[0]?.message).toContain('no saved key');
  }

  test('warns when an account has no saved key', warnsWhenAnAccountHasNoSavedKey);

  async function turnsAFailingPlayAccountIntoAWarning() {
    async function playReportingClient(): Promise<PlayVitalsReader | null> {
      return makePlayClient(new Error('403 denied'));
    }

    makeStatsCredentialsTest({ playReportingClient });

    const report = await discoverApps();

    expect(report.warnings).toEqual([{ accountLabel: 'google-play', message: '403 denied' }]);
    expect(report.attemptedAccountCount).toBe(1);
  }

  test('turns a failing Play account into a warning', turnsAFailingPlayAccountIntoAWarning);

  async function doesNotCountThePlayPieceWhenNoServiceAccountIsSaved() {
    makeStatsCredentialsTest();

    const report = await discoverApps();

    expect(report).toEqual({
      apps: [],
      warnings: [],
      attemptedAccountCount: 0,
      failedAccountLabels: [],
    });
  }

  test(
    'does not count the Play source when no service account is saved',
    doesNotCountThePlayPieceWhenNoServiceAccountIsSaved,
  );
}

describe('discoverApps', describeDiscoverApps);
