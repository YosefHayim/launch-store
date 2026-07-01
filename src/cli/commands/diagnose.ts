/**
 * `launch diagnose [logfile]` — explain a failed native build.
 *
 * Runs Launch's build-failure diagnostics against a build log and prints the likely cause + fix. With
 * no argument it picks the most recent log under `~/.launch/logs` (the ones a failed `launch build`
 * writes). The same diagnosis prints automatically under the interactive build spinner; this command
 * covers the cases that path can't — a CI/non-TTY run where output was streamed raw, or re-examining an
 * earlier failure. Read-only: it never builds or changes anything.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { LOGS_DIR } from '../../core/paths.js';
import { diagnoseBuildLog, formatDiagnoses } from '../../core/buildDiagnostics.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger(false);

/** The most recently modified `*.log` under {@link LOGS_DIR}, or null when there are none. */
function mostRecentLog(): string | null {
  if (!existsSync(LOGS_DIR)) return null;
  const logs = readdirSync(LOGS_DIR)
    .filter((name) => name.endsWith('.log'))
    .map((name) => join(LOGS_DIR, name));
  if (logs.length === 0) return null;
  return logs.reduce((newest, candidate) =>
    statSync(candidate).mtimeMs > statSync(newest).mtimeMs ? candidate : newest,
  );
}

/** Attach the `diagnose` command to the program. */
export function registerDiagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('explain a failed native build — parse the cause + fix from a build log')
    .argument('[logfile]', 'path to a build log (default: the most recent ~/.launch/logs entry)')
    .action((logfile: string | undefined) => {
      const path = logfile ?? mostRecentLog();
      if (!path) {
        log.line(
          'No build log found. Run a build first, or pass a log path: `launch diagnose <file>`.',
        );
        return;
      }
      if (!existsSync(path)) throw new Error(`No log file at ${path}.`);
      const diagnoses = diagnoseBuildLog(readFileSync(path, 'utf8'));
      if (diagnoses.length === 0) {
        log.line(`No known issues recognized in ${path}.`);
        log.line('Open the log to inspect the failure directly.');
        return;
      }
      log.line(`Diagnosing ${path}\n`);
      log.line(formatDiagnoses(diagnoses));
    });
}
