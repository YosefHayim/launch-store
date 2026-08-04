import type { Command } from 'commander';
import {
  dashboardCommandProgram,
  DEFAULT_DASHBOARD_HOST,
  DEFAULT_DASHBOARD_PORT,
  type DashboardCommandInput,
} from '@core/dashboard/command.js';
import { DashboardServerLive } from '@core/dashboard/server.js';
import { Effect } from 'effect';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the local dashboard command. */
export const registerDashboardCommand = (program: Command): void => {
  program
    .command('dashboard')
    .description('serve a local, read-only web UI over your apps, builds, accounts, and secrets')
    .option('--host <host>', 'interface to bind', DEFAULT_DASHBOARD_HOST)
    .option('--port <port>', 'port to bind', String(DEFAULT_DASHBOARD_PORT))
    .option('--json', 'print the dashboard state as JSON and exit (no server)', false)
    .action((commandOptions: DashboardCommandInput) =>
      runCliProgram(
        dashboardCommandProgram(commandOptions).pipe(Effect.provide(DashboardServerLive)),
      ),
    );
};
