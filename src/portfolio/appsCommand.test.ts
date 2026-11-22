import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { resetLogger, useLoggerSink } from '../services/platform/logger.js';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.js';
import {
  makeStatsCredentialsTest,
  useStatsCredentials,
  type AppStoreStatsClient,
  type PlayVitalsReader,
} from '../stats/statsCredentials.js';
import {
  appsListProgram,
  appsTagProgram,
  parseOwnerFlag,
  parsePlatformFlag,
  parseTagRequest,
  type AppsTagRequest,
} from './appsCommand.js';

const ACCOUNTS_FILE = JSON.stringify({
  active: 'KEYA',
  accounts: [
    { keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' },
    { keyId: 'KEYB', issuerId: 'issuer-b', label: 'beta', addedAt: 't' },
  ],
});

const TAG_BASE: AppsTagRequest = {
  app: 'calfriend',
  account: undefined,
  owner: 'mine',
  ga4Property: undefined,
  isJson: false,
};

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

type CommandOutcome =
  | { readonly _tag: 'Right' }
  | { readonly _tag: 'Left'; readonly left: unknown };

async function runProgram(startProgram: () => Promise<void>): Promise<{
  outcome: CommandOutcome;
  lines: string[];
}> {
  const lines: string[] = [];
  useLoggerSink(function writeLine(text: string) {
    lines.push(text);
  });

  var outcome: CommandOutcome;

  try {
    await startProgram();
    outcome = { _tag: 'Right' };
  } catch (left) {
    outcome = { _tag: 'Left', left };
  }

  return { outcome, lines };
}

describe('parsePlatformFlag', () => {
  test('accepts ios, android and no flag', async () => {
    expect(await parsePlatformFlag('ios')).toBe('ios');
    expect(await parsePlatformFlag('android')).toBe('android');
    expect(await parsePlatformFlag(undefined)).toBeNull();
  });

  test('rejects another platform', async () => {
    await expect(parsePlatformFlag('web')).rejects.toMatchObject({
      message: '--platform must be ios or android.',
    });
  });
});

describe('parseOwnerFlag', () => {
  test('accepts mine, client and no flag', async () => {
    expect(await parseOwnerFlag('mine')).toBe('mine');
    expect(await parseOwnerFlag('client')).toBe('client');
    expect(await parseOwnerFlag(undefined)).toBeNull();
  });

  test('rejects another owner', async () => {
    await expect(parseOwnerFlag('me')).rejects.toMatchObject({
      message: '--owner must be mine or client.',
    });
  });
});

describe('parseTagRequest', () => {
  test('needs one of --app or --account', async () => {
    const expected = 'Pass exactly one of --app <name> or --account <label>.';

    await expect(parseTagRequest({ ...TAG_BASE, app: undefined })).rejects.toMatchObject({
      message: expected,
    });
    await expect(parseTagRequest({ ...TAG_BASE, account: 'alpha' })).rejects.toMatchObject({
      message: expected,
    });
  });

  test('needs at least one change', async () => {
    await expect(parseTagRequest({ ...TAG_BASE, owner: undefined })).rejects.toMatchObject({
      message: 'Pass --owner mine|client and/or --ga4-property <id>.',
    });
  });

  test('rejects a GA4 property that is not a number', async () => {
    await expect(parseTagRequest({ ...TAG_BASE, ga4Property: 'abc' })).rejects.toMatchObject({
      message: '--ga4-property must be the numeric GA4 property id.',
    });
  });

  test('rejects an unknown owner', async () => {
    await expect(parseTagRequest({ ...TAG_BASE, owner: 'boss' })).rejects.toMatchObject({
      message: '--owner must be mine or client.',
    });
  });

  test('accepts owner only, property only, or both', async () => {
    const ownerOnly = await parseTagRequest(TAG_BASE);
    const propertyOnly = await parseTagRequest({
      ...TAG_BASE,
      owner: undefined,
      ga4Property: '123',
    });
    const both = await parseTagRequest({ ...TAG_BASE, ga4Property: '123' });

    expect(ownerOnly).toEqual({ owner: 'mine', ga4PropertyId: null });
    expect(propertyOnly).toEqual({ owner: null, ga4PropertyId: '123' });
    expect(both).toEqual({ owner: 'mine', ga4PropertyId: '123' });
  });
});

describe('appsListProgram and appsTagProgram', () => {
  let homeDirectory: string;

  beforeEach(function setAppsHome() {
    homeDirectory = createTemporaryHomeDirectory();
    const project = join(homeDirectory, 'work');
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, 'app.json'),
      JSON.stringify({ expo: { slug: 'fit', android: { package: 'com.jts.fit' } } }),
    );
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
    useLaunchDirectories({ homeDirectory, workingDirectory: project });

    async function ascClientForAccount(keyId: string): Promise<AppStoreStatsClient | null> {
      if (keyId == 'KEYB') {
        return makeAscClient(new Error('401 revoked'));
      }

      return makeAscClient([{ id: '1', name: 'Cal Friend AI', bundleId: 'com.jts.calfriend' }]);
    }

    async function playReportingClient(): Promise<PlayVitalsReader | null> {
      return makePlayClient([{ packageName: 'com.jts.fit', displayName: 'Fit' }]);
    }

    makeStatsCredentialsTest({ ascClientForAccount, playReportingClient });
  });

  afterEach(function resetAppsHome() {
    useStatsCredentials(null);
    resetLogger();
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  test('apps list prints one JSON object with the apps and the warnings', async () => {
    const { outcome, lines } = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: undefined, isJson: true });
    });

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);
    const listing = JSON.parse(lines[0] ?? '');
    expect(listing.ok).toBe(true);
    expect(listing.apps.map((app: { name: string }) => app.name)).toEqual(['Cal Friend AI', 'Fit']);
    expect(listing.warnings).toEqual([{ accountLabel: 'beta', message: '401 revoked' }]);
  });

  test('apps list shows warnings and one line per app, filtered by platform', async () => {
    const { lines } = await runProgram(function startList() {
      return appsListProgram({ platform: 'android', owner: undefined, isJson: false });
    });

    expect(lines.some((line) => line.includes('beta: 401 revoked'))).toBe(true);
    expect(lines.filter((line) => line.includes('Fit (com.jts.fit) - Google Play'))).toHaveLength(
      1,
    );
    expect(lines.some((line) => line.includes('Cal Friend AI'))).toBe(false);
  });

  test('apps list says so when no app matches the filter', async () => {
    const { lines } = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: 'client', isJson: false });
    });

    expect(lines.some((line) => line.includes('No apps found.'))).toBe(true);
  });

  test('apps list exits 2 on a bad platform, as JSON with --json', async () => {
    const { outcome, lines } = await runProgram(function startList() {
      return appsListProgram({ platform: 'web', owner: undefined, isJson: true });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ok: false,
      error: '--platform must be ios or android.',
    });
  });

  test('apps tag saves the owner so the next list shows it', async () => {
    const tagged = await runProgram(function startTag() {
      return appsTagProgram(TAG_BASE);
    });

    expect(tagged.lines.some((line) => line.includes('Tagged Cal Friend AI'))).toBe(true);
    const savedFile = JSON.parse(
      readFileSync(join(homeDirectory, '.launch', 'portfolio.json'), 'utf8'),
    );
    expect(savedFile.tags).toEqual([{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }]);
    const listed = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: 'mine', isJson: true });
    });
    expect(JSON.parse(listed.lines[0] ?? '').apps).toHaveLength(1);
  });

  test('apps tag --account tags every app of that account and prints JSON with --json', async () => {
    const { lines } = await runProgram(function startTag() {
      return appsTagProgram({
        ...TAG_BASE,
        app: undefined,
        account: 'google-play',
        owner: 'client',
        isJson: true,
      });
    });

    const tagging = JSON.parse(lines[0] ?? '');
    expect(tagging.tagged).toHaveLength(1);
    expect(tagging.tagged[0]).toMatchObject({ name: 'Fit', owner: 'client' });
  });

  test('apps tag keeps the old owner when only the property is given', async () => {
    await runProgram(function startTag() {
      return appsTagProgram(TAG_BASE);
    });

    const { lines } = await runProgram(function startPropertyTag() {
      return appsTagProgram({ ...TAG_BASE, owner: undefined, ga4Property: '555', isJson: true });
    });

    expect(JSON.parse(lines[0] ?? '').tagged[0]).toMatchObject({
      owner: 'mine',
      ga4PropertyId: '555',
    });
  });

  test('apps tag exits 2 and lists the known apps when nothing matches', async () => {
    const { outcome, lines } = await runProgram(function startTag() {
      return appsTagProgram({ ...TAG_BASE, app: 'zzz' });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
    expect(lines.some((line) => line.includes('Known apps: Cal Friend AI, Fit'))).toBe(true);
  });

  test('apps tag exits 2 on bad flags', async () => {
    const { outcome } = await runProgram(function startTag() {
      return appsTagProgram({ ...TAG_BASE, owner: undefined });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
  });
});
