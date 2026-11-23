import type { Command } from '@/cli/command.js';

/** Find-or-create the shared `ai` parent command. */
export function aiGroup(program: Command): Command {
  function isAiCommand(command: Command) {
    return command.name() == 'ai';
  }

  const existing = program.commands.find(isAiCommand);

  if (existing != null) return existing;

  return program.command('ai').description('AI-assisted authoring for your store presence');
}
