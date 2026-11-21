import type { ConsumerSkill, SkillStep } from '../types/agents.js';
import { CONSUMER_SKILLS } from './registry.js';

/** Commander-independent command tree used to validate generated agent instructions. */
export type RegisteredCommand = Readonly<{
  readonly name: string;
  readonly aliases: readonly string[];
  readonly commands: readonly RegisteredCommand[];
}>;

/** Find a registered command by primary name or alias within one command list. */
const matchRegisteredCommand = (
  availableCommands: readonly RegisteredCommand[],
  commandName: string,
): RegisteredCommand | undefined => {
  for (const registeredCommand of availableCommands) {
    if (registeredCommand.name === commandName) return registeredCommand;
    if (registeredCommand.aliases.includes(commandName)) return registeredCommand;
  }
  return undefined;
};

/**
 * Whether every segment of a skill command path exists in the registered CLI tree.
 * Empty paths never match - a skill must name at least the top-level command after `launch`.
 */
export const commandPathIsRegistered = (
  registeredCli: RegisteredCommand,
  commandPath: readonly string[],
): boolean => {
  if (commandPath.length === 0) return false;
  let availableCommands = registeredCli.commands;
  for (const commandName of commandPath) {
    const matchedCommand = matchRegisteredCommand(availableCommands, commandName);
    if (matchedCommand === undefined) return false;
    availableCommands = matchedCommand.commands;
  }
  return true;
};

/** Recipe steps plus optional reference-catalog commands for one consumer skill. */
export const skillReferencedCommands = (skill: ConsumerSkill): readonly SkillStep[] => {
  if (skill.reference === undefined) return skill.steps;
  return [...skill.steps, ...skill.reference.commands];
};

/** Human-readable unknown-command diagnostic for one skill path. */
export const formatUnknownSkillCommand = (
  skillId: string,
  commandPath: readonly string[],
): string => `${skillId}: launch ${commandPath.join(' ')}`;

/** Return generated skill commands that no longer exist in the registered CLI. */
export const findUnknownCommands = (
  registeredCli: RegisteredCommand,
  skills: readonly ConsumerSkill[] = CONSUMER_SKILLS,
): readonly string[] => {
  const unknownCommands: string[] = [];
  for (const skill of skills) {
    for (const skillCommand of skillReferencedCommands(skill)) {
      if (commandPathIsRegistered(registeredCli, skillCommand.path)) continue;
      unknownCommands.push(formatUnknownSkillCommand(skill.id, skillCommand.path));
    }
  }
  return unknownCommands;
};
