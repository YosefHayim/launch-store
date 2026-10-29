import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import { makeFakeAscClient, makeFakePlayReportingClient } from '@testkit/storeClients.testkit.js';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
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
  json: false,
};

describe('parsePlatformFlag', () => {
  test('accepts ios, android and no flag', async () => {
    expect(await Effect.runPromise(parsePlatformFlag('ios'))).toBe('ios');
    expect(await Effect.runPromise(parsePlatformFlag('android'))).toBe('android');
    expect(await Effect.runPromise(parsePlatformFlag(undefined))).toBeNull();
  });

  test('rejects another platform', async () => {
    const failure = await Effect.runPromise(parsePlatformFlag('web').pipe(Effect.flip));

    expect(failure.message).toBe('--platform must be ios or android.');
  });
});

describe('parseOwnerFlag', () => {
  test('accepts mine, client and no flag', async () => {
    expect(await Effect.runPromise(parseOwnerFlag('mine'))).toBe('mine');
    expect(await Effect.runPromise(parseOwnerFlag('client'))).toBe('client');
    expect(await Effect.runPromise(parseOwnerFlag(undefined))).toBeNull();
  });

  test('rejects another owner', async () => {
    const failure = await Effect.runPromise(parseOwnerFlag('me').pipe(Effect.flip));

    expect(failure.message).toBe('--owner must be mine or client.');
  });
});

describe('parseTagRequest', () => {
  const messageOf = (request: AppsTagRequest) =>
    Effect.runPromise(parseTagRequest(request).pipe(Effect.flip)).then(
      (failure) => failure.message,
    );

  test('needs one of --app or --account', async () => {
    const expected = 'Pass exactly one of --app <name> or --account <label>.';

    expect(await messageOf({ ...TAG_BASE, app: undefined })).toBe(expected);
    expect(await messageOf({ ...TAG_BASE, account: 'alpha' })).toBe(expected);
  });

  test('needs at least one change', async () => {
    const message = await messageOf({ ...TAG_BASE, owner: undefined });

    expect(message).toBe('Pass --owner mine|client and/or --ga4-property <id>.');
  });

  test('rejects a GA4 property that is not a number', async () => {
    const message = await messageOf({ ...TAG_BASE, ga4Property: 'abc' });

    expect(message).toBe('--ga4-property must be the numeric GA4 property id.');
  });

  test('rejects an unknown owner', async () => {
    expect(await messageOf({ ...TAG_BASE, owner: 'boss' })).toBe('--owner must be mine or client.');
  });

  test('accepts owner only, property only, or both', async () => {
    const ownerOnly = await Effect.runPromise(parseTagRequest(TAG_BASE));
    const propertyOnly = await Effect.runPromise(
      parseTagRequest({ ...TAG_BASE, owner: undefined, ga4Property: '123' }),
    );
    const both = await Effect.runPromise(parseTagRequest({ ...TAG_BASE, ga4Property: '123' }));

    expect(ownerOnly).toEqual({ owner: 'mine', ga4PropertyId: null });
    expect(propertyOnly).toEqual({ owner: null, ga4PropertyId: '123' });
    expect(both).toEqual({ owner: 'mine', ga4PropertyId: '123' });
  });
});

describe('apps programs', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'accounts.json', ACCOUNTS_FILE);
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const credentials = makeStatsCredentialsTest({
    ascClientForAccount: (keyId) => {
      if (keyId === 'KEYB') return Effect.succeed(makeFakeAscClient(new Error('401 revoked')));
      return Effect.succeed(
        makeFakeAscClient([{ id: '1', name: 'Cal Friend AI', bundleId: 'com.jts.calfriend' }]),
      );
    },
    playReportingClient: () =>
      Effect.succeed(
        makeFakePlayReportingClient([{ packageName: 'com.jts.fit', displayName: 'Fit' }]),
      ),
  });

  const runProgram = <Failure>(program: Effect.Effect<void, Failure, never>) => {
    const lines: string[] = [];
    const finished = Effect.runPromise(
      program.pipe(Effect.either, Effect.provide(makeLaunchLoggerTest(lines))),
    );
    return finished.then((outcome) => ({ outcome, lines }));
  };
  const withServices = <Failure>(
    program: ReturnType<typeof appsListProgram> | ReturnType<typeof appsTagProgram>,
  ) =>
    program.pipe(
      Effect.provide(credentials),
      Effect.provide(makeLaunchHomeTest(homeDirectory)),
    ) as Effect.Effect<void, Failure, never>;

  test('apps list prints one JSON object with the apps and the warnings', async () => {
    const { outcome, lines } = await runProgram(
      withServices(appsListProgram({ platform: undefined, owner: undefined, json: true })),
    );

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);
    const listing = JSON.parse(lines[0] ?? '');
    expect(listing.ok).toBe(true);
    expect(listing.apps.map((app: { name: string }) => app.name)).toEqual(['Cal Friend AI', 'Fit']);
    expect(listing.warnings).toEqual([{ accountLabel: 'beta', message: '401 revoked' }]);
  });

  test('apps list shows warnings and one line per app, filtered by platform', async () => {
    const { lines } = await runProgram(
      withServices(appsListProgram({ platform: 'android', owner: undefined, json: false })),
    );

    expect(lines.some((line) => line.includes('beta: 401 revoked'))).toBe(true);
    expect(lines.filter((line) => line.includes('Fit (com.jts.fit) - Google Play'))).toHaveLength(
      1,
    );
    expect(lines.some((line) => line.includes('Cal Friend AI'))).toBe(false);
  });

  test('apps list says so when no app matches the filter', async () => {
    const { lines } = await runProgram(
      withServices(appsListProgram({ platform: undefined, owner: 'client', json: false })),
    );

    expect(lines.some((line) => line.includes('No apps found.'))).toBe(true);
  });

  test('apps list exits 2 on a bad platform, as JSON with --json', async () => {
    const { outcome, lines } = await runProgram(
      withServices(appsListProgram({ platform: 'web', owner: undefined, json: true })),
    );

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ok: false,
      error: '--platform must be ios or android.',
    });
  });

  test('apps tag saves the owner so the next list shows it', async () => {
    const tagged = await runProgram(withServices(appsTagProgram(TAG_BASE)));

    expect(tagged.lines.some((line) => line.includes('Tagged Cal Friend AI'))).toBe(true);
    const savedFile = JSON.parse(
      readFileSync(join(homeDirectory, '.launch', 'portfolio.json'), 'utf8'),
    );
    expect(savedFile.tags).toEqual([{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }]);
    const listed = await runProgram(
      withServices(appsListProgram({ platform: undefined, owner: 'mine', json: true })),
    );
    expect(JSON.parse(listed.lines[0] ?? '').apps).toHaveLength(1);
  });

  test('apps tag --account tags every app of that account and prints JSON with --json', async () => {
    const { lines } = await runProgram(
      withServices(
        appsTagProgram({
          ...TAG_BASE,
          app: undefined,
          account: 'google-play',
          owner: 'client',
          json: true,
        }),
      ),
    );

    const tagging = JSON.parse(lines[0] ?? '');
    expect(tagging.tagged).toHaveLength(1);
    expect(tagging.tagged[0]).toMatchObject({ name: 'Fit', owner: 'client' });
  });

  test('apps tag keeps the old owner when only the property is given', async () => {
    await runProgram(withServices(appsTagProgram(TAG_BASE)));

    const { lines } = await runProgram(
      withServices(
        appsTagProgram({ ...TAG_BASE, owner: undefined, ga4Property: '555', json: true }),
      ),
    );

    expect(JSON.parse(lines[0] ?? '').tagged[0]).toMatchObject({
      owner: 'mine',
      ga4PropertyId: '555',
    });
  });

  test('apps tag exits 2 and lists the known apps when nothing matches', async () => {
    const { outcome, lines } = await runProgram(
      withServices(appsTagProgram({ ...TAG_BASE, app: 'zzz' })),
    );

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
    expect(lines.some((line) => line.includes('Known apps: Cal Friend AI, Fit'))).toBe(true);
  });

  test('apps tag exits 2 on bad flags', async () => {
    const { outcome } = await runProgram(
      withServices(appsTagProgram({ ...TAG_BASE, owner: undefined })),
    );

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
  });
});
