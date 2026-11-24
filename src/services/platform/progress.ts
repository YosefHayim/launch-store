// Says whether the terminal can ask a question. A pipe or CI never waits on stdin.

import { stdout } from 'node:process';
import { readLaunchEnvironment } from './environment.ts';

/** A real interactive TTY that is not a CI runner. */
export function checkTerminalIsInteractive(): boolean {
  const terminalIsInteractive = stdout.isTTY == true;
  const launchEnvironment = readLaunchEnvironment();

  return isInteractiveTerminal(terminalIsInteractive, launchEnvironment.rawVariables);
}

export function isInteractiveTerminal(
  isTTY: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const isNotATerminal = isTTY == false;

  if (isNotATerminal) {
    return false;
  }

  return environment['CI'] == null;
}
