import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { diagnoseBuildLog, formatDiagnoses } from '../../build/build-diagnostics.ts';
import { currentBuildLog } from '../../build/build-log.ts';
import type { BuildEstimate } from '../../build/build-fingerprint.ts';
import { formatElapsed } from './elapsed.ts';
import { executeCommand, executeCommandQuietly } from './exec.ts';
import { readLaunchEnvironment } from './environment.ts';
import { isJsonOutput } from './json-output-mode.ts';
import { createLogger } from './logger.ts';
import { resolveLogsDirectory } from './paths.ts';
/** Process-wide toggle: when true, `runWithProgress` streams the raw tool output instead of a spinner. */
let streamRawOutput = false;
/** Set by the CLI's `--verbose` flag - makes every {@link runWithProgress} stream the full tool output. */
export function setVerboseOutput(verbose: boolean): void {
  streamRawOutput = verbose;
}
/** Whether to render a spinner or stream raw output. */
export function selectProgressMode(
  isTTY: boolean,
  env: Readonly<Record<string, string | undefined>>,
  verbose: boolean,
  json: boolean = false,
): 'spinner' | 'stream' {
  if (json) return 'spinner';
  if (verbose) return 'stream';
  if (!isTTY) return 'stream';
  if (env['CI']) return 'stream';
  return 'spinner';
}
/** Options for {@link runWithProgress}. */
export type ProgressRunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  label: string;
  parseStep?: (line: string) => string | undefined;
  estimate?: BuildEstimate;
};
/** Cap a step string so the spinner stays on one terminal line. */
function truncateStep(step: string): string {
  const max = 52;
  if (step.length > max) return `${step.slice(0, max - 3)}...`;
  return step;
}
/** Render the "candy" Aurora progress bar */
export function renderBar(fraction: number, width: number = 14): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.floor(clamped * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}
/** Compose the one spinner line. */
export function formatProgressLine(parts: {
  label: string;
  step: string;
  elapsedMs: number;
  steps: number;
  estimate?: BuildEstimate;
}): string {
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
}
/** Pull a compact step out of a raw `xcodebuild` line such as `CompileC ...`, `Ld ...` or `** ARCHIVE SUCCEEDED **`. */
export function xcodeProgressStep(line: string): string | undefined {
  const trimmedLine = line.trim();
  const successMatch = /^\*\* (ARCHIVE|EXPORT|BUILD) SUCCEEDED \*\*/.exec(trimmedLine);
  if (successMatch?.[1]) return `${successMatch[1].toLowerCase()} succeeded`;
  const stepMatch =
    /^(CompileC|CompileSwift|SwiftCompile|CompileAssetCatalog|CompileStoryboard|Ld|Libtool|CodeSign|ProcessInfoPlistFile|ProcessProductPackaging|GenerateDSYMFile|CopySwiftLibs|PhaseScriptExecution) (.+?)(?: \(in target .*)?$/.exec(
      trimmedLine,
    );
  const verb = stepMatch?.[1];
  const detail = stepMatch?.[2];
  if (verb == null) return undefined;
  if (detail == null) return truncateStep(verb);
  if (verb == 'PhaseScriptExecution') {
    const scriptMatch = /^(.+?)(?: \/|$)/.exec(detail);
    if (!scriptMatch?.[1]) return truncateStep(verb);
    return truncateStep(`${verb} ${scriptMatch[1].replace(/\\ /g, ' ')}`);
  }
  function findToken(token: string) {
    return token.includes('/');
  }

  const pathToken = detail.split(' ').find(findToken);
  if (pathToken == null) return truncateStep(verb);
  const fileName = pathToken.slice(pathToken.lastIndexOf('/') + 1);
  return truncateStep(`${verb} ${fileName}`);
}
/** Pull a compact step out of a Gradle line. */
export function gradleProgressStep(line: string): string | undefined {
  const match = /^> Task (\S+)/.exec(line.trim());
  if (match?.[1]) return truncateStep(match[1]);
  return undefined;
}
/** A safe-for-a-filename slug of a label, e.g. `"Building iOS - SampleApp"` -> `"building-ios-sampleapp"`. */
function logSlug(label: string): string {
  const normalizedLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalizedLabel.length == 0) return 'run';
  return normalizedLabel;
}
/** A filesystem-safe timestamp, e.g. `2026-06-14T02-56-32`. */
function logStamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}
/** Print a failed tool's captured tail and the path to its full log, then */
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

/** Run a long external tool under a spinner (or stream it raw - see {@link selectProgressMode}). */
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

  const launchEnvironment = readLaunchEnvironment();
  return isInteractiveTerminal(terminalIsInteractive, launchEnvironment.rawVariables);
}
export function isInteractiveTerminal(
  isTTY: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  if (!isTTY) return false;
  return environment['CI'] == null;
}
/** Run a silent async step under a spinner so long network round-trips (App Store Connect / */
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
