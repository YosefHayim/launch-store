import type { Command } from 'commander';
import { mcpCommandProgram } from '@core/mcp/command.js';
import { runCliProgram } from '../runCliProgram.js';

type McpInstallOptions = Readonly<{ client?: string }>;

/** Attach the MCP stdio server and client installer to Commander. */
export const registerMcpCommand = (program: Command): void => {
  const mcpCommand = program
    .command('mcp')
    .description(
      "serve Launch's read-only tools to AI agents over MCP (stdio); `install` wires it into a client",
    )
    .action(() => runCliProgram(mcpCommandProgram({ operation: 'serve' })));

  mcpCommand
    .command('install')
    .description(
      "wire `launch mcp` into an AI client's config (default: auto-detect Claude Code / Cursor)",
    )
    .option('--client <name>', 'claude-code | cursor | claude-desktop (default: auto-detect)')
    .action((commandOptions: McpInstallOptions) =>
      runCliProgram(mcpCommandProgram({ operation: 'install', client: commandOptions.client })),
    );
};
