/**
 * The anti-rot guard for the agent skill registry.
 *
 * Every command a {@link ConsumerSkill} names is a structured {@link SkillStep} whose `path` must
 * resolve to a real (sub)command in the live `launch` program. {@link findUnknownCommands} walks the
 * commander tree and returns any path that no longer resolves, so a renamed or removed command turns
 * into a failing test (`src/core/agents/validate.test.ts`) and a loud error at `launch agents` time —
 * instead of a recipe that silently tells an agent to run a command that doesn't exist.
 */

import type { Command } from 'commander';
import { CONSUMER_SKILLS } from './registry.js';
import type { ConsumerSkill } from '../types.js';

/**
 * Whether a command path (subcommand names only, no args) resolves in the program tree. Descends one
 * level per segment, matching a command's `name()` or any alias; returns false if a segment is missing
 * or the path is empty (an empty path would match the program root, which is never a real step).
 */
function pathResolves(program: Command, path: string[]): boolean {
  if (path.length === 0) return false;
  let node: Command | undefined = program;
  for (const name of path) {
    node = node.commands.find((child) => child.name() === name || child.aliases().includes(name));
    if (!node) return false;
  }
  return true;
}

/**
 * Return a human-readable list of every skill command whose path no longer resolves against `program`.
 * Empty means the registry is in sync with the CLI. Checks both each skill's happy-path `steps` and its
 * `reference.commands`, so the bundled reference can't rot either.
 */
export function findUnknownCommands(
  program: Command,
  skills: ConsumerSkill[] = CONSUMER_SKILLS,
): string[] {
  const unknown: string[] = [];
  for (const skill of skills) {
    const steps = [...skill.steps, ...(skill.reference?.commands ?? [])];
    for (const step of steps) {
      if (!pathResolves(program, step.path))
        unknown.push(`${skill.id}: launch ${step.path.join(' ')}`);
    }
  }
  return unknown;
}
