/**
 * `launch dashboard [--host] [--port] [--json]` — a strictly-local web UI over Launch's existing state.
 *
 * It binds a tiny `node:http` server (no framework, no new dependency) that serves one self-contained
 * HTML page summarising what's readable from `launch.config.ts` + `~/.launch`: apps, profiles, the
 * provider wiring, Apple accounts, recent build artifacts, build-secret coordinates, and any live remote
 * host. Everything is read-only and offline — no App Store Connect call, nothing hosted — so it's safe
 * to leave running and great for a glance or a demo. The page re-reads local state on every request, so
 * a browser reload always shows the current snapshot. `--json` prints that snapshot and exits instead of
 * serving, for CI/agents.
 *
 * All domain logic lives in the pure `core/dashboard/*` (gather + render); this file is just the I/O
 * shell — argument validation and the server lifecycle.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Command } from 'commander';
import { createLogger, type Logger } from '../../core/logger.js';
import { READINESS_EXIT } from '../../core/readiness/orchestrator.js';
import { gatherDashboardState } from '../../core/dashboard/state.js';
import { renderDashboardHtml } from '../../core/dashboard/render.js';

const log = createLogger(false);

/** Loopback by default — the dashboard exposes local state and must not be reachable off the machine. */
const DEFAULT_HOST = '127.0.0.1';
/** A memorable, rarely-claimed default port ("launch" on a phone keypad). */
const DEFAULT_PORT = 4477;

/** Resolved, validated inputs for {@link runDashboard}. */
export interface DashboardInput {
  /** Interface to bind — keep it loopback unless you knowingly want LAN access. */
  host: string;
  /** TCP port to bind (1–65535). */
  port: number;
  /** Print the snapshot as JSON and exit instead of serving the UI. */
  json: boolean;
}

/** Serve the dashboard for one request: re-read local state and render it, or 404/500 as appropriate. */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  log: Logger,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const html = renderDashboardHtml(await gatherDashboardState());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    log.error(`dashboard render failed: ${error instanceof Error ? error.message : String(error)}`);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Failed to read local state — see the terminal running `launch dashboard`.');
  }
}

/** Bind the server and resolve once it's listening; reject with an actionable message if the port is taken. */
function serve(host: string, port: number, log: Logger): Promise<void> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, log);
  });
  return new Promise<void>((resolve, reject) => {
    const onStartupError = (error: NodeJS.ErrnoException): void => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} on ${host} is already in use — pick another with --port.`)
          : error,
      );
    };
    server.once('error', onStartupError);
    server.listen(port, host, () => {
      server.removeListener('error', onStartupError);
      server.on('error', (error) => {
        log.error(`dashboard server error: ${error.message}`);
      });
      log.info(`launch dashboard → http://${host}:${port}  ·  Ctrl+C to stop`);
      resolve();
    });
  });
}

/**
 * Run the dashboard. With `--json`, gather the snapshot, print it, and return (exit 0). Otherwise start
 * the local server — gathering once up front so a broken config fails fast before binding — and serve
 * until the process is interrupted.
 */
export async function runDashboard(input: DashboardInput): Promise<void> {
  if (input.json) {
    log.line(JSON.stringify(await gatherDashboardState(), null, 2));
    process.exitCode = READINESS_EXIT.ok;
    return;
  }
  await gatherDashboardState(); // fail fast on an unreadable config, before we bind a port
  await serve(input.host, input.port, log);
}

/** Attach the `dashboard` command to the program. */
export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('serve a local, read-only web UI over your apps, builds, accounts, and secrets')
    .option('--host <host>', 'interface to bind', DEFAULT_HOST)
    .option('--port <port>', 'port to bind', String(DEFAULT_PORT))
    .option('--json', 'print the dashboard state as JSON and exit (no server)', false)
    .action(async (options: { host: string; port: string; json: boolean }) => {
      const port = Number.parseInt(options.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(
          `Invalid --port "${options.port}" — must be an integer between 1 and 65535.`,
        );
      }
      await runDashboard({ host: options.host, port, json: options.json });
    });
}
