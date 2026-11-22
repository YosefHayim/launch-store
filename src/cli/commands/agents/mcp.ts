import type { Command } from '../../command.ts';
import { mcpCommandProgram } from '../../../mcp/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type McpInstallOptions = Readonly<{ client?: string }>;

/** Attach the MCP stdio server and client installer to Commander. */
export const registerMcpCommand = (program: Command): void => {
  const mcpCommand = program
    .command('mcp')
    .description(
      "serve Launch's read-only tools to AI agents over MCP (stdio); `install` wires it into a client",
    )
    .action(() => {
      const mcpProgram = mcpCommandProgram({ operation: 'serve' });
      return runCliProgram(mcpProgram);
    });

  mcpCommand
    .command('install')
    .description(
      "wire `launch mcp` into an AI client's config (default: auto-detect Claude Code / Cursor)",
    )
    .option('--client <name>', 'claude-code | cursor | claude-desktop (default: auto-detect)')
    .action((commandOptions: McpInstallOptions) => {
      const mcpProgram = mcpCommandProgram({ operation: 'install', client: commandOptions.client });
      return runCliProgram(mcpProgram);
    });
};
