import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/launch-home-testkit.ts';
import {
  readDateDaysAgo,
  STATS_PORTFOLIO_FILE,
  writeStatsMonthFiles,
} from '../testkit/stats-home-testkit.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from './stats-credentials.ts';
import { statsReportProgram, type StatsCommandRequest } from './stats-command.ts';

const fakeFeed = vi.hoisted(function hoistFakeFeed() {
  return { isFailing: false };
});

vi.mock('./feed-registry.ts', function mockFeedRegistry() {
  const iosFeed = {
    feed: 'app-store' as const,
    isApplicable(app: { platform: string }) {
      return app.platform == 'ios';
    },
    async fetchDays() {
      if (fakeFeed.isFailing) {
        throw {
          _tag: 'StatsFeedFailure',
          feed: 'app-store',
          appKey: 'ios-1',
          message: 'report not ready',
          cause: null,
        };
      }

      return { status: 'skipped' as const, reason: 'not built yet' };
    },
  };

  return { STATS_FEED_PLUGINS: [iosFeed] };
});

const ALL_APPS_REQUEST: StatsCommandRequest = {
  platform: undefined,
  owner: undefined,
  app: undefined,
  days: undefined,
  json: false,
};

type CommandOutcome =
  | { readonly _tag: 'Right' }
  | { readonly _tag: 'Left'; readonly left: unknown };

function describeStatsReportProgram() {
  let homeDirectory: string;

  function prepareStatsReportProgram() {
    homeDirectory = createTemporaryHomeDirectory();

    const workPath = join(homeDirectory, 'work');

    useLaunchDirectories({
      homeDirectory,
      workingDirectory: workPath,
    });

    const serialized = JSON.stringify(STATS_PORTFOLIO_FILE);

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    const dateDaysAgo = readDateDaysAgo(1);

    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: dateDaysAgo,
        feed: 'app-store',
        metric: 'downloads',
        value: 1200,
        currency: null,
      },
    ]);
    makeStatsCredentialsTest();
    fakeFeed.isFailing = false;
  }

  beforeEach(prepareStatsReportProgram);

  function cleanupStatsReportProgram() {
    useStatsCredentials(null);
    resetLogger();
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupStatsReportProgram);

  async function run(request: StatsCommandRequest) {
    const lines: string[] = [];

    useLoggerSink(function writeLine(text: string) {
      lines.push(text);
    });

    var outcome: CommandOutcome;

    try {
      await statsReportProgram(request);
      outcome = { _tag: 'Right' };
    } catch (left) {
      outcome = { _tag: 'Left', left };
    }

    return { outcome, lines };
  }

  async function printsOneJSONObjectWithTheReportWithPiece() {
    const { outcome, lines } = await run({ ...ALL_APPS_REQUEST, json: true, days: '7' });

    expect(outcome._tag).toBe('Right');
    expect(lines).toHaveLength(1);

    const report = JSON.parse(lines[0] ?? '');

    expect(report.ok).toBe(true);
    expect(report.days).toBe(7);
    expect(report.apps).toHaveLength(2);
  }

  test(
    'prints one JSON object with the report with --json',
    printsOneJSONObjectWithTheReportWithPiece,
  );

  async function printsABlockPerAppWithoutPiece() {
    const { lines } = await run(ALL_APPS_REQUEST);

    const text = lines.join('');

    expect(text).toContain('Cal Friend AI (ios, mine, alpha)');
    expect(text).toContain('1,200');
    expect(text).not.toContain('Some numbers are old');
  }

  test('prints a block per app without --json', printsABlockPerAppWithoutPiece);

  async function saysWhenNoAppMatchesTheFilters() {
    const { lines } = await run({ ...ALL_APPS_REQUEST, owner: 'client' });

    expect(lines.join('')).toContain('No apps found.');
  }

  test('says when no app matches the filters', saysWhenNoAppMatchesTheFilters);

  async function printsAWarningWhenASyncFailed() {
    fakeFeed.isFailing = true;

    const { outcome, lines } = await run(ALL_APPS_REQUEST);

    expect(outcome._tag).toBe('Right');
    expect(lines.join('')).toContain('[WARN]');
    expect(lines.join('')).toContain('Some numbers are old');
  }

  test('prints a warning when a sync failed', printsAWarningWhenASyncFailed);

  async function exits2WithAJSONErrorForABadDays() {
    const { outcome, lines } = await run({ ...ALL_APPS_REQUEST, days: '0', json: true });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });

    const parsed = JSON.parse(lines[0] ?? '');

    expect(parsed.ok).toBe(false);
  }

  test('exits 2 with a JSON error for a bad --days', exits2WithAJSONErrorForABadDays);

  async function exits2WhenNoAppMatchesTheName() {
    const { outcome } = await run({ ...ALL_APPS_REQUEST, app: 'nothing' });

    expect(outcome).toMatchObject({ _tag: 'Left', left: { _tag: 'CommandExit', exitCode: 2 } });
  }

  test('exits 2 when no app matches the name', exits2WhenNoAppMatchesTheName);
}

describe('statsReportProgram', describeStatsReportProgram);
