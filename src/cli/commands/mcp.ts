/**
 * `launch mcp` — serve Launch as an MCP server, and wire it into an AI client.
 *
 * Two surfaces, both thin glue over `core/mcp`:
 *   - `launch mcp` (no subcommand) starts the stdio server ({@link startMcpServer}) so a coding agent can
 *     call Launch's read-only tools (plan, drift, audit, the doctors, config, snapshots) in-process. The
 *     exposed set is gated by `mcp: { capabilities }` in `launch.config.ts` — read-only by default.
 *   - `launch mcp install [--client]` merges a `launch` entry into a client's MCP config
 *     ({@link installServer}), preserving any servers already there; with no `--client` it installs into
 *     every detected client.
 *
 * The serve path must never write to stdout (the stdio transport owns it for JSON-RPC framing), so this
 * file prints nothing on that path — `startMcpServer` logs its readiness line to stderr. `install` is an
 * ordinary command and prints normally.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createLogger } from '../../core/logger.js';
import { startMcpServer } from '../../core/mcp/server.js';
import { installServer, type McpClient } from '../../core/mcp/install.js';

/** The clients `install` understands, in display order. */
const ALL_CLIENTS: McpClient[] = ['claude-code', 'cursor', 'claude-desktop'];

/** Human label per client for install output. */
const CLIENT_LABELS: Record<McpClient, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  'claude-desktop': 'Claude Desktop',
};

/**
 * Detect which clients a repo already uses, so `install` with no `--client` targets the right ones: a
 * `.mcp.json` or `.claude/` means Claude Code, a `.cursor/` means Cursor. Claude Desktop is global (no
 * project marker), so it's only targeted when named explicitly with `--client`.
 */
function detectClients(cwd: string): McpClient[] {
  const clients: McpClient[] = [];
  if (existsSync(join(cwd, '.mcp.json')) || existsSync(join(cwd, '.claude')))
    clients.push('claude-code');
  if (existsSync(join(cwd, '.cursor'))) clients.push('cursor');
  return clients;
}

/** Validate a `--client` value into the {@link McpClient} union, or throw a usage error. */
function parseClient(value: string): McpClient {
  if (!ALL_CLIENTS.includes(value as McpClient)) {
    throw new Error(`Unknown client "${value}". Use ${ALL_CLIENTS.join(', ')}.`);
  }
  return value as McpClient;
}

/** `launch mcp install` — merge the Launch server into one or all detected client configs. */
function runInstall(options: { client?: string }): void {
  const log = createLogger(false);
  const cwd = process.cwd();
  const targets = options.client ? [parseClient(options.client)] : detectClients(cwd);

  if (targets.length === 0) {
    log.info(
      'No MCP client detected here. Pass --client claude-code|cursor|claude-desktop to install explicitly.',
    );
    return;
  }

  for (const client of targets) {
    const { path, changed } = installServer(client);
    if (changed) log.step(CLIENT_LABELS[client], `wired \`launch\` into ${path}`);
    else log.step(CLIENT_LABELS[client], `already configured (${path})`);
  }
  log.gap();
  log.info(
    'Restart the client to pick up the server, then ask its agent to run a Launch tool (e.g. `plan`).',
  );
}

/** Attach the `mcp` command (default action serves; `install` subcommand wires clients) to the program. */
export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description(
      "serve Launch's read-only tools to AI agents over MCP (stdio); `install` wires it into a client",
    )
    .action(async () => {
      await startMcpServer();
    });

  mcp
    .command('install')
    .description(
      "wire `launch mcp` into an AI client's config (default: auto-detect Claude Code / Cursor)",
    )
    .option('--client <name>', 'claude-code | cursor | claude-desktop (default: auto-detect)')
    .action((options: { client?: string }) => {
      runInstall(options);
    });
}
