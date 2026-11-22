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
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { makeStatsCredentialsTest, useStatsCredentials } from '../stats/stats-credentials.ts';
import type { McpToolResult } from '../types/mcp.ts';
import { dispatch } from './server.ts';
import { STATS_TOOLS } from './stats-tools.ts';
import type { McpTool } from '../types/mcp.ts';

const fakeFeed = vi.hoisted(() => ({ isFailing: false }));

vi.mock('../stats/feed-registry.ts', () => {
  const iosFeed = {
    feed: 'app-store' as const,
    isApplicable(app: { platform: string }) {
      return app.platform == 'ios';
    },
    async fetchDays() {
      const isFailing = fakeFeed.isFailing;

      if (isFailing) {
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

function findTool(toolName: string): McpTool {
  const foundTool = STATS_TOOLS.find(function isNamedTool(statsTool: McpTool): boolean {
    return statsTool.name == toolName;
  });

  if (foundTool == null) {
    throw new Error(`missing tool ${toolName}`);
  }

  return foundTool;
}

function appKey(app: { key: string }): string {
  return app.key;
}

function readReport(toolOutput: McpToolResult): {
  days: number;
  isStale: boolean;
  apps: { key: string; totals: unknown[] }[];
} {
  const textBlock = toolOutput.content[0];

  if (textBlock == null) {
    throw new Error('missing tool text');
  }

  return JSON.parse(textBlock.text);
}

describe('STATS_TOOLS', () => {
  let homeDirectory: string;

  beforeEach(() => {
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
        value: 12,
        currency: null,
      },
    ]);
    makeStatsCredentialsTest();
    fakeFeed.isFailing = false;
  });

  afterEach(() => {
    useStatsCredentials(null);
    resetLaunchDirectories();
    removeTemporaryHomeDirectory(homeDirectory);
  });

  function callTool(
    toolName: string,
    toolArguments: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return dispatch(findTool(toolName), toolArguments);
  }

  test('lists exactly the two read-tier stats tools', () => {
    expect(
      STATS_TOOLS.map(function toolIdentity(statsTool: McpTool): [string, string] {
        return [statsTool.name, statsTool.capability];
      }),
    ).toEqual([
      ['stats_portfolio', 'read'],
      ['stats_app', 'read'],
    ]);
  });

  test('stats_portfolio returns the report of all apps', async () => {
    const toolOutput = await callTool('stats_portfolio', { days: 7 });
    const report = readReport(toolOutput);

    expect(toolOutput.isError).toBeUndefined();
    expect(report.days).toBe(7);
    expect(report.apps).toHaveLength(2);
  });

  test('stats_portfolio narrows by platform and owner', async () => {
    const toolOutput = await callTool('stats_portfolio', { platform: 'ios', owner: 'mine' });

    expect(readReport(toolOutput).apps.map(appKey)).toEqual(['ios-1']);
  });

  test('stats_app returns one app found by name', async () => {
    const toolOutput = await callTool('stats_app', { app: 'cal friend' });
    const report = readReport(toolOutput);

    expect(report.days).toBe(30);
    expect(report.apps.map(appKey)).toEqual(['ios-1']);
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
    const report = readReport(toolOutput);

    expect(toolOutput.isError).toBeUndefined();
    expect(report.isStale).toBe(true);

    const firstApp = report.apps[0];

    if (firstApp == null) {
      throw new Error('missing app');
    }

    expect(firstApp.totals.length).toBeGreaterThan(0);
  });
});
