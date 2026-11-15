import type { Command } from 'commander';
/**
 * Find-or-create the shared `ai` parent command. Each `ai <sub>` registrar calls this so every subcommand
 * lands under one group regardless of which registrar runs first.
 */
export const aiGroup = (program: Command): Command => {
  const existing = program.commands.find((command) => command.name() === 'ai');
  if (existing !== undefined) return existing;
  return program.command('ai').description('AI-assisted authoring for your store presence');
};
