import type { Command } from 'commander';
import { Effect } from 'effect';
import { agentsCommandProgram, type AgentsCommandOptions } from '@core/agents/command.js';
import { AgentsCommandServiceLive } from '@core/agents/commandLive.js';
import type { RegisteredCommand } from '@core/agents/validate.js';
import { runCliProgram } from '../runCliProgram.js';

/** Convert Commander's registered tree into the core validator's transport-free shape. */
export const registeredCommandTree = (command: Command): RegisteredCommand => ({
  name: command.name(),
  aliases: command.aliases(),
  commands: command.commands.map(registeredCommandTree),
});

/** Attach the agents command family and its init/check subcommands. */
export const registerAgentsCommand = (program: Command): void => {
  const agentsCommand = program
    .command('agents')
    .description(
      'scaffold agent skills/rules (Claude, Cursor, Codex, Windsurf, Copilot, Kiro, Cline, Amazon Q) so coding agents can drive Launch',
    )
    .action(() => {
      agentsCommand.help();
    });
  agentsCommand
    .command('init')
    .description('write agent skills/rules for all detected coding agents into this repo')
    .option(
      '--agent <list>',
      'claude | cursor | codex | windsurf | copilot | kiro | cline | amazonq | all (comma-separated; default: auto-detect)',
    )
    .option('-y, --yes', 'non-interactive: skip the confirmation prompt (CI, agents)', false)
    .action((commandOptions: AgentsCommandOptions) =>
      runCliProgram(
        agentsCommandProgram({
          mode: 'init',
          launchVersion: program.version(),
          registeredCli: registeredCommandTree(program),
          options: commandOptions,
        }).pipe(Effect.provide(AgentsCommandServiceLive)),
      ),
    );
  agentsCommand
    .command('check')
    .description('verify the scaffolded agent files are in sync with the installed Launch')
    .option(
      '--agent <list>',
      'claude | cursor | codex | windsurf | copilot | kiro | cline | amazonq | all (comma-separated; default: auto-detect)',
    )
    .action((commandOptions: AgentsCommandOptions) =>
      runCliProgram(
        agentsCommandProgram({
          mode: 'check',
          launchVersion: program.version(),
          registeredCli: registeredCommandTree(program),
          options: commandOptions,
        }).pipe(Effect.provide(AgentsCommandServiceLive)),
      ),
    );
};
