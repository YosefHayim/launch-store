import type { ConsumerSkill } from '../types/agents.js';
import { CONSUMER_SKILLS } from './registry.js';

/** Commander-independent command tree used to validate generated agent instructions. */
export type RegisteredCommand = Readonly<{
  readonly name: string;
  readonly aliases: readonly string[];
  readonly commands: readonly RegisteredCommand[];
}>;

/** Check whether a generated command path exists in the registered CLI tree. */
const pathResolves = (
  registeredCli: RegisteredCommand,
  commandPath: readonly string[],
): boolean => {
  if (commandPath.length === 0) return false;
  let availableCommands = registeredCli.commands;
  for (const commandName of commandPath) {
    const matchedCommand = availableCommands.find((registeredCommand) => {
      if (registeredCommand.name === commandName) return true;
      return registeredCommand.aliases.includes(commandName);
    });
    if (matchedCommand === undefined) return false;
    availableCommands = matchedCommand.commands;
  }
  return true;
};

/** Return generated skill commands that no longer exist in the registered CLI. */
export const findUnknownCommands = (
  registeredCli: RegisteredCommand,
  skills: readonly ConsumerSkill[] = CONSUMER_SKILLS,
): string[] => {
  const unknownCommands: string[] = [];
  for (const skill of skills) {
    const referencedCommands = [...skill.steps];
    if (skill.reference !== undefined) referencedCommands.push(...skill.reference.commands);
    for (const skillCommand of referencedCommands) {
      if (pathResolves(registeredCli, skillCommand.path)) continue;
      unknownCommands.push(`${skill.id}: launch ${skillCommand.path.join(' ')}`);
    }
  }
  return unknownCommands;
};
