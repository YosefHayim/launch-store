import type { Command } from '../../command.ts';
/**
 * Find-or-create the shared `ai` parent command. Each `ai <sub>` registrar calls this so every subcommand
 * lands under one group regardless of which registrar runs first.
 */
export function aiGroup(program: Command): Command {
  function findCommand(command: Command) {
    return command.name() == 'ai';
  }

  const existing = program.commands.find(findCommand);
  if (existing != null) return existing;
  return program.command('ai').description('AI-assisted authoring for your store presence');
}
