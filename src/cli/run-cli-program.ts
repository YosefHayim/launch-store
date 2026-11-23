// Runs one Launch command, and prints one JSON result line when JSON output is on.

import { stderr, stdout } from 'node:process';
import { errorMessage } from '../services/platform/error-message.ts';
import { setJsonOutput } from '../services/platform/json-output-mode.ts';
import { jsonLine, useJsonHumanWriter } from '../services/platform/logger.ts';
import { useJsonPrompts } from '../services/platform/prompt.ts';
import { isCommandExit } from '../terminal/command-exit.ts';

/** The fixed fields of a `--json` run's final result line. */
type JsonRunSummary = Readonly<{
  command: 'build' | 'release';
  platform: string;
  dryRun: boolean;
  profile: string;
}>;

/** Run one command program. The program already carries its own dependencies. */
export async function runCliProgram<Success>(program: Promise<Success>): Promise<Success> {
  return program;
}

function jsonFailureMessage(cause: unknown): string {
  const isExit = isCommandExit(cause);

  if (isExit == false) {
    return errorMessage(cause);
  }

  if (cause.message != null) {
    return cause.message;
  }

  return `The command ended with exit code ${cause.exitCode}.`;
}

function writeStdout(text: string): void {
  stdout.write(text);
}

function writeStderr(text: string): void {
  stderr.write(text);
}

/** Run a command for `--json`. */
export async function runJsonCliProgram<Success>(
  summary: JsonRunSummary,
  startProgram: () => Promise<Success>,
): Promise<void> {
  setJsonOutput(true);
  useJsonPrompts(true);
  useJsonHumanWriter(writeStderr);

  try {
    await startProgram();
    const machineLine = jsonLine({ event: 'result', ok: true, ...summary });
    writeStdout(machineLine);
  } catch (cause) {
    const message = jsonFailureMessage(cause);
    const machineLine = jsonLine({ event: 'result', ok: false, ...summary, message });
    writeStdout(machineLine);
    throw new Error(message, { cause });
  } finally {
    setJsonOutput(false);
    useJsonPrompts(false);
    useJsonHumanWriter(null);
  }
}
