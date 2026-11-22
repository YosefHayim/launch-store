import { parseOwnerFlag, parsePlatformFlag } from '../portfolio/appsCommand.js';
import { createStatsReport } from '../stats/statsReport.js';
import { parseDaysFlag } from '../stats/statsSyncCommand.js';
import type { McpTool, McpToolResult } from '../types/mcp.js';
import type { StatsReportRequest } from '../types/statsReport.js';
import { jsonToolOutput, optionalString, requiredString } from './tools.js';

const DAYS_DESCRIPTION = 'how many days back to show, 1 to 365 (default 30)';

function readDaysArgument(argumentsRecord: Record<string, unknown>): string | undefined {
  const daysArgument = argumentsRecord['days'];

  if (typeof daysArgument == 'number') {
    return String(daysArgument);
  }

  return undefined;
}

async function readPortfolioRequest(
  argumentsRecord: Record<string, unknown>,
): Promise<StatsReportRequest> {
  const platform = await parsePlatformFlag(optionalString(argumentsRecord, 'platform'));
  const owner = await parseOwnerFlag(optionalString(argumentsRecord, 'owner'));
  const daysArgument = readDaysArgument(argumentsRecord);
  const days = parseDaysFlag(daysArgument);

  return { platform, owner, appName: null, days };
}

async function readAppRequest(
  argumentsRecord: Record<string, unknown>,
): Promise<StatsReportRequest> {
  const appName = requiredString(argumentsRecord, 'app');
  const daysArgument = readDaysArgument(argumentsRecord);
  const days = parseDaysFlag(daysArgument);

  return { platform: null, owner: null, appName, days };
}

async function createReportReply(request: StatsReportRequest): Promise<McpToolResult> {
  const report = await createStatsReport(request);

  return jsonToolOutput(report);
}

async function statsPortfolio(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  const request = await readPortfolioRequest(argumentsRecord);

  return createReportReply(request);
}

async function statsApp(argumentsRecord: Record<string, unknown>): Promise<McpToolResult> {
  const request = await readAppRequest(argumentsRecord);

  return createReportReply(request);
}

/** The stats tools read saved numbers, so they work with no launch.config in the folder. */
export const STATS_TOOLS: readonly McpTool[] = [
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
    handler: statsPortfolio,
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
    handler: statsApp,
  },
];
