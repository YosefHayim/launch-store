import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import {
  makeStatsCredentialsTest,
  useStatsCredentials,
  type AppStoreStatsClient,
  type PlayVitalsReader,
} from '../stats/stats-credentials.ts';
import {
  appsListProgram,
  appsTagProgram,
  parseOwnerFlag,
  parsePlatformFlag,
  parseTagRequest,
  type AppsTagRequest,
} from './apps-command.ts';

const accountsFile = JSON.stringify({
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
function describeParsePlatformFlag() {
  async function acceptsIosAndroidAndNoFlag() {
    const platformFlag = await parsePlatformFlag('ios');
    expect(platformFlag).toBe('ios');
    expect(await parsePlatformFlag('android')).toBe('android');
    expect(await parsePlatformFlag(undefined)).toBeNull();
  }

  test('accepts ios, android and no flag', acceptsIosAndroidAndNoFlag);
  async function rejectsAnotherPlatform() {
    const platformFlag = parsePlatformFlag('web');
    await expect(platformFlag).rejects.toMatchObject({
      message: '--platform must be ios or android.',
    });
  }

  test('rejects another platform', rejectsAnotherPlatform);
}

describe('parsePlatformFlag', describeParsePlatformFlag);
function describeParseOwnerFlag() {
  async function acceptsMineClientAndNoFlag() {
    const ownerFlag = await parseOwnerFlag('mine');
    expect(ownerFlag).toBe('mine');
    expect(await parseOwnerFlag('client')).toBe('client');
    expect(await parseOwnerFlag(undefined)).toBeNull();
  }

  test('accepts mine, client and no flag', acceptsMineClientAndNoFlag);
  async function rejectsAnotherOwner() {
    const ownerFlag = parseOwnerFlag('me');
    await expect(ownerFlag).rejects.toMatchObject({
      message: '--owner must be mine or client.',
    });
  }

  test('rejects another owner', rejectsAnotherOwner);
}

describe('parseOwnerFlag', describeParseOwnerFlag);
function describeParseTagRequest() {
  async function needsOneOfAppOrAccount() {
    const expected = 'Pass exactly one of --app <name> or --account <label>.';

    const tagRequest = parseTagRequest({ ...TAG_BASE, app: undefined });
    await expect(tagRequest).rejects.toMatchObject({
      message: expected,
    });
    await expect(parseTagRequest({ ...TAG_BASE, account: 'alpha' })).rejects.toMatchObject({
      message: expected,
    });
  }

  test('needs one of --app or --account', needsOneOfAppOrAccount);
  async function needsAtLeastOneChange() {
    const tagRequest = parseTagRequest({ ...TAG_BASE, owner: undefined });
    await expect(tagRequest).rejects.toMatchObject({
      message: 'Pass --owner mine|client and/or --ga4-property <id>.',
    });
  }

  test('needs at least one change', needsAtLeastOneChange);
  async function rejectsAGA4PropertyThatIsNotANumber() {
    const tagRequest = parseTagRequest({ ...TAG_BASE, ga4Property: 'abc' });
    await expect(tagRequest).rejects.toMatchObject({
      message: '--ga4-property must be the numeric GA4 property id.',
    });
  }

  test('rejects a GA4 property that is not a number', rejectsAGA4PropertyThatIsNotANumber);
  async function rejectsAnUnknownOwner() {
    const tagRequest = parseTagRequest({ ...TAG_BASE, owner: 'boss' });
    await expect(tagRequest).rejects.toMatchObject({
      message: '--owner must be mine or client.',
    });
  }

  test('rejects an unknown owner', rejectsAnUnknownOwner);
  async function acceptsOwnerOnlyPropertyOnlyOrBoth() {
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
  }

  test('accepts owner only, property only, or both', acceptsOwnerOnlyPropertyOnlyOrBoth);
}

describe('parseTagRequest', describeParseTagRequest);
function describeAppsListProgramAndAppsTagProgram() {
  let homeDirectory: string;

  beforeEach(function setAppsHome() {
    homeDirectory = createTemporaryHomeDirectory();
    const project = join(homeDirectory, 'work');
    mkdirSync(project, { recursive: true });
    const appPath = join(project, 'app.json');
    const serialized = JSON.stringify({
      expo: { slug: 'fit', android: { package: 'com.jts.fit' } },
    });
    writeFileSync(appPath, serialized);
    writeLaunchHomeFile(homeDirectory, 'accounts.json', accountsFile);
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
  async function appsListPrintsOneJSONObjectWithTheAppsAndTheWarnings() {
    const { outcome, lines } = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: undefined, isJson: true });
    });

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);
    const listing = JSON.parse(lines[0] ?? '');
    expect(listing.ok).toBe(true);
    function readName(app: { name: string }) {
      return app.name;
    }

    expect(listing.apps.map(readName)).toEqual(['Cal Friend AI', 'Fit']);
    expect(listing.warnings).toEqual([{ accountLabel: 'beta', message: '401 revoked' }]);
  }

  test(
    'apps list prints one JSON object with the apps and the warnings',
    appsListPrintsOneJSONObjectWithTheAppsAndTheWarnings,
  );
  async function appsListShowsWarningsAndOneLinePerAppFilteredByPlatform() {
    const { lines } = await runProgram(function startList() {
      return appsListProgram({ platform: 'android', owner: undefined, isJson: false });
    });
    function someLine(line: string) {
      return line.includes('beta: 401 revoked');
    }

    expect(lines.some(someLine)).toBe(true);
    function filterLine(line: string) {
      return line.includes('Fit (com.jts.fit) - Google Play');
    }

    expect(lines.filter(filterLine)).toHaveLength(1);
    function someLine2(line: string) {
      return line.includes('Cal Friend AI');
    }

    expect(lines.some(someLine2)).toBe(false);
  }

  test(
    'apps list shows warnings and one line per app, filtered by platform',
    appsListShowsWarningsAndOneLinePerAppFilteredByPlatform,
  );
  async function appsListSaysSoWhenNoAppMatchesTheFilter() {
    const { lines } = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: 'client', isJson: false });
    });
    function someLine3(line: string) {
      return line.includes('No apps found.');
    }

    expect(lines.some(someLine3)).toBe(true);
  }

  test('apps list says so when no app matches the filter', appsListSaysSoWhenNoAppMatchesTheFilter);
  async function appsListExits2OnABadPlatformAsJSONWithPiece() {
    const { outcome, lines } = await runProgram(function startList() {
      return appsListProgram({ platform: 'web', owner: undefined, isJson: true });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed).toEqual({
      ok: false,
      error: '--platform must be ios or android.',
    });
  }

  test(
    'apps list exits 2 on a bad platform, as JSON with --json',
    appsListExits2OnABadPlatformAsJSONWithPiece,
  );
  async function appsTagSavesTheOwnerSoTheNextListShowsIt() {
    const tagged = await runProgram(function startTag() {
      return appsTagProgram(TAG_BASE);
    });
    function someLine4(line: string) {
      return line.includes('Tagged Cal Friend AI');
    }

    expect(tagged.lines.some(someLine4)).toBe(true);
    const portfolioPath = join(homeDirectory, '.launch', 'portfolio.json');
    const loadedFile = readFileSync(portfolioPath, 'utf8');
    const savedFile = JSON.parse(loadedFile);
    expect(savedFile.tags).toEqual([{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }]);
    const listed = await runProgram(function startList() {
      return appsListProgram({ platform: undefined, owner: 'mine', isJson: true });
    });
    const parsed = JSON.parse(listed.lines[0] ?? '');
    expect(parsed.apps).toHaveLength(1);
  }

  test(
    'apps tag saves the owner so the next list shows it',
    appsTagSavesTheOwnerSoTheNextListShowsIt,
  );
  async function appsTagAccountTagsEveryAppOfThatAccountAndPrintsJSONWithPiece() {
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
  }

  test(
    'apps tag --account tags every app of that account and prints JSON with --json',
    appsTagAccountTagsEveryAppOfThatAccountAndPrintsJSONWithPiece,
  );
  async function appsTagKeepsTheOldOwnerWhenOnlyThePropertyIsGiven() {
    await runProgram(function startTag() {
      return appsTagProgram(TAG_BASE);
    });

    const { lines } = await runProgram(function startPropertyTag() {
      return appsTagProgram({ ...TAG_BASE, owner: undefined, ga4Property: '555', isJson: true });
    });

    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed.tagged[0]).toMatchObject({
      owner: 'mine',
      ga4PropertyId: '555',
    });
  }

  test(
    'apps tag keeps the old owner when only the property is given',
    appsTagKeepsTheOldOwnerWhenOnlyThePropertyIsGiven,
  );
  async function appsTagExits2AndListsTheKnownAppsWhenNothingMatches() {
    const { outcome, lines } = await runProgram(function startTag() {
      return appsTagProgram({ ...TAG_BASE, app: 'zzz' });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
    function someLine5(line: string) {
      return line.includes('Known apps: Cal Friend AI, Fit');
    }

    expect(lines.some(someLine5)).toBe(true);
  }

  test(
    'apps tag exits 2 and lists the known apps when nothing matches',
    appsTagExits2AndListsTheKnownAppsWhenNothingMatches,
  );
  async function appsTagExits2OnBadFlags() {
    const { outcome } = await runProgram(function startTag() {
      return appsTagProgram({ ...TAG_BASE, owner: undefined });
    });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { exitCode: 2 } });
  }

  test('apps tag exits 2 on bad flags', appsTagExits2OnBadFlags);
}

describe('appsListProgram and appsTagProgram', describeAppsListProgramAndAppsTagProgram);
