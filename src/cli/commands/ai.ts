/**
 * The shared `ai` command group and the local-write confirmation both of its subcommands use.
 *
 * `launch ai` houses the AI-assisted authoring subcommands — `ai listing` (draft store copy) and
 * `ai screenshots` (enhance store screenshots via the genshot backend). Each is registered from its own
 * file, but they must attach to ONE `ai` parent: a second `program.command("ai")` throws on the duplicate
 * name. {@link aiGroup} is the single find-or-create owner of that parent, so registration order doesn't
 * matter. {@link confirmWrite} is the one local gate both subcommands pass before touching disk.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';

/**
 * Find-or-create the shared `ai` parent command. Each `ai <sub>` registrar calls this so every subcommand
 * lands under one group regardless of which registrar runs first.
 */
export function aiGroup(program: Command): Command {
  const existing = program.commands.find((command) => command.name() === 'ai');
  return (
    existing ?? program.command('ai').description('AI-assisted authoring for your store presence')
  );
}

/**
 * Gate a local write on one confirmation. Returns true when `--yes` was passed; otherwise prompts on a
 * TTY and refuses (throws) in a non-interactive shell so a CI run never silently writes. A declined or
 * cancelled prompt prints an "aborted" notice and returns false.
 */
export async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error('Refusing to write without confirmation. Re-run with --yes (non-interactive).');
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel('Aborted — nothing written.');
    return false;
  }
  return true;
}
