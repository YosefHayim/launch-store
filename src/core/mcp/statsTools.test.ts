import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeHttpClientTest } from '@testkit/httpClient.testkit.js';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '@testkit/launchHome.testkit.js';
import {
  readDateDaysAgo,
  STATS_PORTFOLIO_FILE,
  writeStatsMonthFiles,
} from '@testkit/statsHome.testkit.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
import type { StatsFeedFailure, StatsFeedPlugin } from '../types/stats.js';
import { dispatch } from './server.js';
import { STATS_TOOLS } from './statsTools.js';

const fakeFeed = vi.hoisted(() => ({ isFailing: false }));

vi.mock('../stats/feedRegistry.js', async () => {
  const { Effect: EffectModule } = await import('effect');
  const iosFeed: StatsFeedPlugin = {
    feed: 'app-store',
    isApplicable: (app) => app.platform === 'ios',
    fetchDays: () => {
      if (fakeFeed.isFailing) {
        return EffectModule.fail({
          _tag: 'StatsFeedFailure',
          feed: 'app-store',
          appKey: 'ios-1',
          message: 'report not ready',
          cause: null,
        } satisfies StatsFeedFailure);
      }
      return EffectModule.succeed({ status: 'skipped', reason: 'not built yet' });
    },
  };
  return { STATS_FEED_PLUGINS: [iosFeed] };
});

const findTool = (toolName: string) => {
  const foundTool = STATS_TOOLS.find((statsTool) => statsTool.name === toolName);
  if (foundTool === undefined) throw new Error(`missing tool ${toolName}`);
  return foundTool;
};

describe('STATS_TOOLS', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
    writeLaunchHomeFile(homeDirectory, 'portfolio.json', JSON.stringify(STATS_PORTFOLIO_FILE));
    writeStatsMonthFiles(homeDirectory, 'ios-1', [
      {
        date: readDateDaysAgo(1),
        feed: 'app-store',
        metric: 'downloads',
        value: 12,
        currency: null,
      },
    ]);
    fakeFeed.isFailing = false;
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const callTool = (toolName: string, toolArguments: Record<string, unknown>) =>
    Effect.runPromise(
      dispatch(findTool(toolName), toolArguments).pipe(
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(makeHttpClientTest([])),
        Effect.provide(makeLaunchHomeTest(homeDirectory)),
      ),
    );

  const readReport = (toolOutput: Awaited<ReturnType<typeof callTool>>) =>
    JSON.parse(toolOutput.content[0]?.text ?? '');

  test('lists exactly the two read-tier stats tools', () => {
    expect(STATS_TOOLS.map((statsTool) => [statsTool.name, statsTool.capability])).toEqual([
      ['stats_portfolio', 'read'],
      ['stats_app', 'read'],
    ]);
  });

  test('stats_portfolio returns the report of all apps', async () => {
    const toolOutput = await callTool('stats_portfolio', { days: 7 });

    expect(toolOutput.isError).toBeUndefined();
    const report = readReport(toolOutput);
    expect(report.days).toBe(7);
    expect(report.apps).toHaveLength(2);
  });

  test('stats_portfolio narrows by platform and owner', async () => {
    const toolOutput = await callTool('stats_portfolio', { platform: 'ios', owner: 'mine' });

    expect(readReport(toolOutput).apps.map((app: { key: string }) => app.key)).toEqual(['ios-1']);
  });

  test('stats_app returns one app found by name', async () => {
    const toolOutput = await callTool('stats_app', { app: 'cal friend' });

    const report = readReport(toolOutput);
    expect(report.days).toBe(30);
    expect(report.apps.map((app: { key: string }) => app.key)).toEqual(['ios-1']);
  });

  test('stats_app without an app is an invalid-arguments error', async () => {
    const toolOutput = await callTool('stats_app', {});

    expect(toolOutput.isError).toBe(true);
  });

  test('an unknown app or a bad days value is an error result', async () => {
    const unknownApp = await callTool('stats_app', { app: 'nothing' });
    const badDays = await callTool('stats_portfolio', { days: 0 });

    expect(unknownApp.isError).toBe(true);
    expect(badDays.isError).toBe(true);
  });

  test('a failed sync is not an error: the saved numbers come back with isStale true', async () => {
    fakeFeed.isFailing = true;

    const toolOutput = await callTool('stats_portfolio', {});

    expect(toolOutput.isError).toBeUndefined();
    const report = readReport(toolOutput);
    expect(report.isStale).toBe(true);
    expect(report.apps[0].totals.length).toBeGreaterThan(0);
  });
});
