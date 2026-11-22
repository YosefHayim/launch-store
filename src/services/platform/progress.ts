import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { diagnoseBuildLog, formatDiagnoses } from '../../build/buildDiagnostics.ts';
import { currentBuildLog } from '../../build/buildLog.ts';
import type { BuildEstimate } from '../../build/buildFingerprint.ts';
import { formatElapsed } from './elapsed.ts';
import { executeCommand, executeCommandQuietly } from './exec.ts';
import { readLaunchEnvironment } from './environment.ts';
import { isJsonOutput } from './jsonOutputMode.ts';
import { createLogger } from './logger.ts';
import { resolveLogsDirectory } from './paths.ts';
/** Process-wide toggle: when true, `runWithProgress` streams the raw tool output instead of a spinner. */
let streamRawOutput = false;
/** Set by the CLI's `--verbose` flag - makes every {@link runWithProgress} stream the full tool output. */
export const setVerboseOutput = (verbose: boolean): void => {
  streamRawOutput = verbose;
};
/**
 * Whether to render a spinner or stream raw output. Pure so the decision is unit-testable. A spinner
 * needs a real interactive TTY that isn't CI and hasn't asked for verbose output; everything else
 * gets the raw stream so the full log survives in transcripts. `--json` always takes the quiet path,
 * so child output never reaches the NDJSON stdout.
 */
export const selectProgressMode = (
  isTTY: boolean,
  env: Readonly<Record<string, string | undefined>>,
  verbose: boolean,
  json = false,
): 'spinner' | 'stream' => {
  if (json) return 'spinner';
  if (verbose) return 'stream';
  if (!isTTY) return 'stream';
  if (env['CI']) return 'stream';
  return 'spinner';
};
/** Options for {@link runWithProgress}. */
export type ProgressRunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  label: string;
  parseStep?: (line: string) => string | undefined;
  estimate?: BuildEstimate;
};
/** Cap a step string so the spinner stays on one terminal line. */
const truncateStep = (step: string): string => {
  const max = 52;
  if (step.length > max) return `${step.slice(0, max - 3)}...`;
  return step;
};
/**
 * Render the "candy" Aurora progress bar - rounded violet/cyan end-caps (``...``) around a heavy ``
 * fill that ramps violet->cyan, over a dim `` track. `fraction` is clamped to 0-1 so an over-budget
 * build (more steps/time than last time) shows a full-but-capped bar rather than overflowing the line.
 * On a color TTY each fill cell is its own gradient step; off a TTY / under `NO_COLOR` it degrades to a
 * plain ``, still legible in any captured log.
 */
export const renderBar = (fraction: number, width = 14): string => {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.floor(clamped * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
};
/**
 * Compose the one spinner line. With a {@link BuildEstimate} it shows a bar plus `count/~total` and
 * `elapsed / ~eta`; the bar fills by step-count (a good time proxy once steps parse) and falls back to
 * elapsed/eta before the first step or when no steps are emitted. With no estimate (the first build of a
 * kind, or a step-less tool like prebuild) it degrades to the plain `label - step   elapsed` clock. The
 * fraction is capped at 99% so the bar never reads "done" until the process actually exits. Pure -> testable.
 */
export const formatProgressLine = (parts: {
  label: string;
  step: string;
  elapsedMs: number;
  steps: number;
  estimate?: BuildEstimate;
}): string => {
  const { label, step, elapsedMs, steps, estimate } = parts;
  let stepSuffix = '';
  if (step) stepSuffix = ` - ${step}`;
  const head = `${label}${stepSuffix}`;
  const elapsed = formatElapsed(elapsedMs);
  if (!estimate) return `${head}   ${elapsed}`;
  if (estimate.ms <= 0) return `${head}   ${elapsed}`;
  const bySteps = estimate.steps > 0 && steps > 0;
  // Cap at 99% so the bar (and the percent) never read "done" until the process actually exits.
  let progressFraction = elapsedMs / estimate.ms;
  if (bySteps) progressFraction = steps / estimate.steps;
  const fraction = Math.min(progressFraction, 0.99);
  const bar = renderBar(fraction);
  const pct = `${Math.round(fraction * 100)}%`;
  let counter = '';
  if (bySteps) counter = ` ${steps}/~${estimate.steps}`;
  return `${head}   ${bar} ${pct}${counter} - ${elapsed} / ~${formatElapsed(estimate.ms)}`;
};
const XCODE_STEP_LINE =
  /^(CompileC|CompileSwift|SwiftCompile|CompileAssetCatalog|CompileStoryboard|Ld|Libtool|CodeSign|ProcessInfoPlistFile|ProcessProductPackaging|GenerateDSYMFile|CopySwiftLibs|PhaseScriptExecution) (.+?)(?: \(in target .*)?$/;
const XCODE_SUCCESS_LINE = /^\*\* (ARCHIVE|EXPORT|BUILD) SUCCEEDED \*\*/;
const XCODE_SCRIPT_NAME = /^(.+?)(?: \/|$)/;
/** Pull a compact step out of a raw `xcodebuild` line such as `CompileC ...`, `Ld ...` or `** ARCHIVE SUCCEEDED **`. */
export const xcodeProgressStep = (line: string): string | undefined => {
  const trimmedLine = line.trim();
  const successMatch = XCODE_SUCCESS_LINE.exec(trimmedLine);
  if (successMatch?.[1]) return `${successMatch[1].toLowerCase()} succeeded`;
  const stepMatch = XCODE_STEP_LINE.exec(trimmedLine);
  const verb = stepMatch?.[1];
  const detail = stepMatch?.[2];
  if (verb === undefined) return undefined;
  if (detail === undefined) return truncateStep(verb);
  if (verb === 'PhaseScriptExecution') {
    const scriptMatch = XCODE_SCRIPT_NAME.exec(detail);
    if (!scriptMatch?.[1]) return truncateStep(verb);
    return truncateStep(`${verb} ${scriptMatch[1].replace(/\\ /g, ' ')}`);
  }
  const pathToken = detail.split(' ').find((token) => token.includes('/'));
  if (pathToken === undefined) return truncateStep(verb);
  const fileName = pathToken.slice(pathToken.lastIndexOf('/') + 1);
  return truncateStep(`${verb} ${fileName}`);
};
/**
 * Pull a compact step out of a Gradle line. Gradle announces work as `> Task :app:bundleRelease`,
 * so we surface the task path; bundletool/other lines are ignored.
 */
export const gradleProgressStep = (line: string): string | undefined => {
  const match = /^> Task (\S+)/.exec(line.trim());
  if (match?.[1]) return truncateStep(match[1]);
  return undefined;
};
/** A safe-for-a-filename slug of a label, e.g. `"Building iOS - SampleApp"` -> `"building-ios-sampleapp"`. */
const logSlug = (label: string): string => {
  const normalizedLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalizedLabel.length === 0) return 'run';
  return normalizedLabel;
};
/** A filesystem-safe timestamp, e.g. `2026-06-14T02-56-32`. */
const logStamp = (epochMilliseconds: number): string => {
  return new Date(epochMilliseconds).toISOString().replace(/:/g, '-').replace(/\..+$/, '');
};
/**
 * Print a failed tool's captured tail and the path to its full log, then - when the log matches a known
 * native-build failure - the likely cause and the fix (see {@link diagnoseBuildLog}). Diagnostics scan
 * the full log on disk (falling back to the in-memory tail if it can't be read), since the real cause
 * sometimes precedes the trailing lines.
 */
async function reportFailure(
  label: string,
  tail: readonly string[],
  logFile: string,
): Promise<void> {
  const lines = [
    `${label} failed. Last lines:`,
    ...tail.map(function indentLine(line: string) {
      return `  ${line}`;
    }),
    '',
    `Full log: ${logFile}`,
  ];
  let logText = tail.join('\n');

  try {
    logText = await readFile(logFile, 'utf8');
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      logText = tail.join('\n');
    }
  }

  const diagnosis = formatDiagnoses(diagnoseBuildLog(logText));

  if (diagnosis) {
    lines.push('', diagnosis);
  }

  createLogger(false).progressFail(label, lines.join('\n'));
}

async function pickProgressLogFile(label: string): Promise<string> {
  const buildLog = currentBuildLog();

  if (buildLog != null) {
    return buildLog;
  }

  const logsDirectory = resolveLogsDirectory();
  await mkdir(logsDirectory, { recursive: true });
  const logTimestamp = Date.now();

  return join(logsDirectory, `${logSlug(label)}-${logStamp(logTimestamp)}.log`);
}

type ProgressCommandOptions = {
  workingDirectory?: string;
  environmentOverrides?: Record<string, string>;
};

function commandOptionsFromProgress(options: ProgressRunOptions): ProgressCommandOptions {
  const commandOptions: ProgressCommandOptions = {};

  if (options.cwd != null) {
    commandOptions.workingDirectory = options.cwd;
  }

  if (options.env != null) {
    commandOptions.environmentOverrides = options.env;
  }

  return commandOptions;
}

type ProgressRun = {
  elapsedMs: number;
  steps: number;
};

/**
 * Run a long external tool under a spinner (or stream it raw - see {@link selectProgressMode}).
 *
 * In spinner mode the full output is tee'd to a per-run file under the logs directory; the spinner
 * shows the live step from `parseStep` and a running clock; on failure the tail and log path are
 * printed before the error propagates. In stream mode the child inherits stdio.
 */
export async function runWithProgress(
  command: string,
  args: readonly string[],
  options: ProgressRunOptions,
): Promise<ProgressRun> {
  const commandOptions = commandOptionsFromProgress(options);
  const environment = readLaunchEnvironment();
  const terminalIsInteractive = stdout.isTTY == true;
  const progressMode = selectProgressMode(
    terminalIsInteractive,
    environment.rawVariables,
    streamRawOutput,
    isJsonOutput(),
  );

  if (progressMode == 'stream') {
    const startedAt = Date.now();
    await executeCommand(command, args, commandOptions);
    const completedAt = Date.now();

    return { elapsedMs: completedAt - startedAt, steps: 0 };
  }

  const logFile = await pickProgressLogFile(options.label);
  const startedAt = Date.now();
  const tail: string[] = [];
  let steps = 0;
  const logger = createLogger(false);
  logger.progressStart(options.label);

  function rememberLine(line: string): void {
    tail.push(line);
    const tailLines = 40;

    if (tail.length > tailLines) {
      tail.shift();
    }

    if (options.parseStep == null) {
      return;
    }

    const nextStep = options.parseStep(line);

    if (nextStep == null) {
      return;
    }

    if (nextStep.length == 0) {
      return;
    }

    steps += 1;
  }

  try {
    await executeCommandQuietly(command, args, {
      ...commandOptions,
      logFilePath: logFile,
      onLine: rememberLine,
    });
    const completedAt = Date.now();
    logger.progressDone(options.label, completedAt - startedAt);

    return { elapsedMs: completedAt - startedAt, steps };
  } catch (error) {
    await reportFailure(options.label, tail, logFile);
    throw error;
  }
}

/** A real interactive TTY that is not a CI runner. In CI or a pipe we never block on stdin. */
export function checkTerminalIsInteractive(): boolean {
  const terminalIsInteractive = stdout.isTTY == true;

  return isInteractiveTerminal(terminalIsInteractive, readLaunchEnvironment().rawVariables);
}
export const isInteractiveTerminal = (
  isTTY: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): boolean => {
  if (!isTTY) return false;
  return environment['CI'] === undefined;
};
/**
 * Run a silent async step under a spinner so long network round-trips (App Store Connect / Google
 * Play lookups, the TestFlight processing poll) don't show a frozen screen. Degrades to a plain
 * awaited call - no animation - whenever {@link selectProgressMode} picks "stream" (non-TTY, CI, or
 * `--verbose`), so logs and scripts stay clean. Unlike {@link runWithProgress} it drives no child
 * process; it just awaits `task` while telling the user what's happening.
 */
export async function withSpinner<TaskResult>(
  label: string,
  task: () => Promise<TaskResult>,
): Promise<TaskResult> {
  const logger = createLogger(false);
  const startedAt = Date.now();
  logger.progressStart(label);

  try {
    const taskResult = await task();
    const completedAt = Date.now();
    logger.progressDone(label, completedAt - startedAt);

    return taskResult;
  } catch (error) {
    logger.progressFail(label, `${label} failed`);
    throw error;
  }
}
