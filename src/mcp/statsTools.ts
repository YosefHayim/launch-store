import { Effect } from 'effect';
import { parseOwnerFlag, parsePlatformFlag } from '../portfolio/appsCommand.js';
import { createStatsReport } from '../stats/statsReport.js';
import { parseDaysFlag } from '../stats/statsSyncCommand.js';
import type { StatsSyncRequirements } from '../stats/syncStats.js';
import type { McpTool, McpToolResult } from '../types/mcp.js';
import type { StatsReportRequest } from '../types/statsReport.js';
import { jsonToolOutput, optionalString, requiredString } from './tools.js';

const DAYS_DESCRIPTION = 'how many days back to show, 1 to 365 (default 30)';

const readDaysArgument = (argumentsRecord: Record<string, unknown>): string | undefined => {
  const daysArgument = argumentsRecord['days'];
  if (typeof daysArgument !== 'number') return undefined;
  return String(daysArgument);
};

const readPortfolioRequest = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<StatsReportRequest, unknown> =>
  Effect.gen(function* () {
    const platform = yield* parsePlatformFlag(optionalString(argumentsRecord, 'platform'));
    const owner = yield* parseOwnerFlag(optionalString(argumentsRecord, 'owner'));
    const days = yield* parseDaysFlag(readDaysArgument(argumentsRecord));
    return { platform, owner, appName: null, days };
  });

const readAppRequest = (
  argumentsRecord: Record<string, unknown>,
): Effect.Effect<StatsReportRequest, unknown> =>
  Effect.gen(function* () {
    const appName = yield* requiredString(argumentsRecord, 'app');
    const days = yield* parseDaysFlag(readDaysArgument(argumentsRecord));
    return { platform: null, owner: null, appName, days };
  });

const createReportReply = (
  request: StatsReportRequest,
): Effect.Effect<McpToolResult, unknown, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const report = yield* createStatsReport(request);
    return jsonToolOutput(report);
  });

/** The stats tools: they read saved numbers, so they work from any folder without a launch.config. */
export const STATS_TOOLS: readonly McpTool<StatsSyncRequirements>[] = [
  {
    name: 'stats_portfolio',
    description:
      'Downloads, proceeds per currency, sessions, crash rate and rating of all your apps, with a daily series per metric. Old numbers come back with isStale: true.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['ios', 'android'], description: 'only one store' },
        owner: { type: 'string', enum: ['mine', 'client'], description: 'only apps with this tag' },
        days: { type: 'integer', description: DAYS_DESCRIPTION },
      },
    },
    handler: (argumentsRecord) =>
      readPortfolioRequest(argumentsRecord).pipe(Effect.flatMap(createReportReply)),
  },
  {
    name: 'stats_app',
    description:
      'The same numbers for one app, found by part of its name, bundle id or package name.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'part of the app name, bundle id or package name' },
        days: { type: 'integer', description: DAYS_DESCRIPTION },
      },
      required: ['app'],
    },
    handler: (argumentsRecord) =>
      readAppRequest(argumentsRecord).pipe(Effect.flatMap(createReportReply)),
  },
];
