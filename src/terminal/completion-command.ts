// Installs shell completion, prints the script, or lists candidates for one tab press.

import type { Command } from '../cli/command.ts';
import { stdout } from 'node:process';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import type { Shell } from '../types/remote.ts';
import {
  completionScript,
  detectShell,
  installCompletion,
  makeCompletionFailure,
  parseShell,
  resolveCompletions,
} from './completion.ts';

type CompletionCommandInput =
  | Readonly<{ operation: 'install'; shell: string | undefined }>
  | Readonly<{ operation: 'script'; shell: string | undefined }>
  | Readonly<{ operation: 'complete'; words: readonly string[]; commandTree: Command }>;

function readShell(shellText: string | undefined): Shell {
  if (shellText != null) {
    return parseShell(shellText);
  }

  const launchEnvironment = readLaunchEnvironment();
  const detectedShell = detectShell(launchEnvironment.rawVariables);

  if (detectedShell != null) {
    return detectedShell;
  }

  throw makeCompletionFailure({
    message: 'Could not detect your shell. Pass one explicitly: bash, zsh, or fish.',
  });
}

async function showInstallOutcome(shellText: string | undefined): Promise<void> {
  const logger = createLogger(false);
  const shell = readShell(shellText);
  const installOutcome = await installCompletion({ shell });

  if (installOutcome.status == 'manual') {
    logger.warn(`Could not edit ${installOutcome.rcFile} - its directory does not exist yet.`);

    const shellName = installOutcome.shell;
    const sourceLine = installOutcome.line;
    const manualLine = `Add this line to your ${shellName} config, then restart your shell: ${sourceLine}`;

    logger.tip(manualLine);

    return;
  }

  let installVerb = 'installed';

  const didUpdateExistingBlock = installOutcome.updated;

  if (didUpdateExistingBlock) {
    installVerb = 'updated';
  }

  const installDetail = `${installVerb} for ${installOutcome.shell} in ${installOutcome.rcFile}`;

  logger.step('completion', installDetail);
  logger.tip('Restart your shell (or source the rc file) to activate it.');
}

async function printCompletionScript(shellText: string | undefined): Promise<void> {
  const shell = readShell(shellText);
  stdout.write(completionScript(shell));
}

async function printCompletionCandidates(
  words: readonly string[],
  commandTree: Command,
): Promise<void> {
  const candidates = await resolveCompletions([...words], commandTree);
  stdout.write(`${candidates.join('\n')}\n`);
}

export async function completionCommandProgram(
  commandInput: CompletionCommandInput,
): Promise<void> {
  switch (commandInput.operation) {
    case 'install':
      await showInstallOutcome(commandInput.shell);
      return;
    case 'script':
      await printCompletionScript(commandInput.shell);
      return;
    case 'complete':
      await printCompletionCandidates(commandInput.words, commandInput.commandTree);
      return;
  }
}
