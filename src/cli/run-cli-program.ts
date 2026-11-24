// Runs one Launch command, and prints one JSON result line when JSON output is on.

import { stdout } from 'node:process';
import { errorMessage } from '../services/platform/error-message.ts';
import { setJsonOutput } from '../services/platform/json-output-mode.ts';
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

function writeJsonLine(event: Readonly<Record<string, unknown>>): void {
  stdout.write(`${JSON.stringify(event)}\n`);
}

/** Run a command for `--json`. */
export async function runJsonCliProgram<Success>(
  summary: JsonRunSummary,
  startProgram: () => Promise<Success>,
): Promise<void> {
  setJsonOutput(true);
  useJsonPrompts(true);

  try {
    await startProgram();
    writeJsonLine({ event: 'result', ok: true, ...summary });
  } catch (cause) {
    const isExit = isCommandExit(cause);

    if (isExit == false) {
      const message = errorMessage(cause);

      writeJsonLine({ event: 'result', ok: false, ...summary, message });
      throw new Error(message, { cause });
    }

    let message = `The command ended with exit code ${cause.exitCode}.`;
    const hasExitMessage = cause.message != null;

    if (hasExitMessage) {
      message = cause.message;
    }

    writeJsonLine({ event: 'result', ok: false, ...summary, message });
    throw new Error(message, { cause });
  } finally {
    setJsonOutput(false);
    useJsonPrompts(false);
  }
}
