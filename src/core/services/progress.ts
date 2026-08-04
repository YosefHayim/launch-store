import { FileSystem, Path, Terminal } from '@effect/platform';
import { Clock, Effect } from 'effect';
import { executeCommand, executeCommandQuietly } from './exec.js';
import { resolveLogsDirectory } from './paths.js';
import { diagnoseBuildLog, formatDiagnoses } from '../build/buildDiagnostics.js';
import { currentBuildLog } from '../build/buildLog.js';
import type { BuildEstimate } from '../build/buildFingerprint.js';
import { createLogger } from './logger.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from './environment.js';
/** Process-wide toggle: when true, `runWithProgress` streams the raw tool output instead of a spinner. */
let streamRawOutput = false;
/** Set by the CLI's `--verbose` flag - makes every {@link runWithProgress} stream the full tool output. */
export const setVerboseOutput = (verbose: boolean): void => {
  streamRawOutput = verbose;
};
/**
 * Whether to render a spinner or stream raw output. Pure so the decision is unit-testable. A spinner
 * needs a real interactive TTY that isn't CI and hasn't asked for verbose output; everything else
 * gets the raw stream so the full log survives in transcripts.
 */
export const selectProgressMode = (
  isTTY: boolean,
  env: NodeJS.ProcessEnv,
  verbose: boolean,
): 'spinner' | 'stream' => {
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
/** What {@link runWithProgress} measured - fed back to {@link import("../build/buildFingerprint.js").updateEstimate}. */
export type RunProgressResult = {
  elapsedMs: number;
  steps: number;
};
/** Trailing lines kept in memory to show as context when a tool fails. */
const TAIL_LINES = 40;
/** Cap a step string so the spinner stays on one terminal line. */
const truncateStep = (step: string): string => {
  const max = 52;
  if (step.length > max) return `${step.slice(0, max - 3)}...`;
  return step;
};
/** Format an elapsed millisecond span as `"45s"` or `"2m 04s"`. */
export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
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
/** Pull the step text from an xcpretty progress line. */
export const xcodeProgressStep = (line: string): string | undefined => {
  const match = /\u25b8\s*(.+)/.exec(line);
  if (match?.[1]) return truncateStep(match[1].trim());
  return undefined;
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
const reportFailure = (label: string, tail: string[], logFile: string) =>
  Effect.gen(function* () {
    const lines = [
      `${label} failed. Last lines:`,
      ...tail.map((line) => `  ${line}`),
      '',
      `Full log: ${logFile}`,
    ];
    let logText = tail.join('\n');
    const fileSystem = yield* FileSystem.FileSystem;
    logText = yield* fileSystem
      .readFileString(logFile)
      .pipe(Effect.catchAll(() => Effect.succeed(logText)));
    const diagnosis = formatDiagnoses(diagnoseBuildLog(logText));
    if (diagnosis) lines.push('', diagnosis);
    const logger = yield* createLogger(false);
    yield* logger.error(lines.join('\n'));
  });
/**
 * Run a long external tool under a spinner (or stream it raw - see {@link selectProgressMode}).
 *
 * In spinner mode the full output is tee'd to a per-run file under {@link LOGS_DIR}; the spinner
 * shows the live step from `parseStep` and a running clock; on failure the tail and log path are
 * printed before the error propagates. In stream mode it is exactly {@link run} (inherited stdio).
 */
export const runWithProgress = (command: string, args: string[], options: ProgressRunOptions) =>
  Effect.gen(function* () {
    const { label, parseStep, ...progressCommandOptions } = options;
    const commandOptions: {
      workingDirectory?: string;
      environmentOverrides?: Record<string, string>;
    } = {};
    if (progressCommandOptions.cwd !== undefined) {
      commandOptions.workingDirectory = progressCommandOptions.cwd;
    }
    if (progressCommandOptions.env !== undefined) {
      commandOptions.environmentOverrides = progressCommandOptions.env;
    }
    const environment = yield* LaunchEnvironment;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    if (
      selectProgressMode(terminalIsInteractive, environment.rawVariables, streamRawOutput) ===
      'stream'
    ) {
      // Raw streaming (CI / piped / --verbose): no bar, but still time the run so the duration EMA learns.
      // Output isn't parsed here, so step count is 0 - the caller carries the prior step total forward.
      const startedAt = yield* Clock.currentTimeMillis;
      yield* executeCommand(command, args, commandOptions);
      const completedAt = yield* Clock.currentTimeMillis;
      return { elapsedMs: completedAt - startedAt, steps: 0 };
    }
    // A build in progress claims the per-build log (redacted, keyed by build id); standalone steps
    // (e.g. prebuild, before the id is known) fall back to a transient stamped file kept raw.
    const buildLog = currentBuildLog();
    let logFile = buildLog;
    if (logFile === null) {
      const fileSystem = yield* FileSystem.FileSystem;
      const logsDirectory = yield* resolveLogsDirectory();
      yield* fileSystem.makeDirectory(logsDirectory, { recursive: true });
      const path = yield* Path.Path;
      const logTimestamp = yield* Clock.currentTimeMillis;
      logFile = path.join(logsDirectory, `${logSlug(label)}-${logStamp(logTimestamp)}.log`);
    }
    const startedAt = yield* Clock.currentTimeMillis;
    const tail: string[] = [];
    let steps = 0;
    const logger = yield* createLogger(false);
    yield* logger.run(label);
    yield* executeCommandQuietly(command, args, {
      ...commandOptions,
      logFilePath: logFile,
      shouldRedactSecrets: buildLog !== null,
      onLine: (line) => {
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        const next = parseStep?.(line);
        if (next) steps++;
      },
    }).pipe(
      Effect.tap(() =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((completedAt) =>
            logger.ok(`${label} - ${formatElapsed(completedAt - startedAt)}`),
          ),
        ),
      ),
      Effect.tapError(() => reportFailure(label, tail, logFile)),
    );
    const completedAt = yield* Clock.currentTimeMillis;
    return { elapsedMs: completedAt - startedAt, steps };
  });
/**
 * Whether we can safely prompt the user: a real interactive TTY that isn't a CI runner. Drives the
 * pre-upload confirmation - in CI or a pipe we never block on stdin; we proceed and log instead. Args
 * default to the live process but are injectable so the decision is unit-testable (like
 * {@link selectProgressMode}).
 */
export const checkTerminalIsInteractive: Effect.Effect<
  boolean,
  never,
  Terminal.Terminal | LaunchEnvironmentService
> = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const environment = yield* LaunchEnvironment;
  const isTTY = yield* terminal.isTTY;
  return isInteractiveTerminal(isTTY, environment.rawVariables);
});
export const isInteractiveTerminal = (isTTY: boolean, environment: NodeJS.ProcessEnv): boolean => {
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
export const withSpinner = <T, TError, TRequirements>(
  label: string,
  task: () => Effect.Effect<T, TError, TRequirements>,
) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const startedAt = yield* Clock.currentTimeMillis;
    yield* logger.run(label);
    return yield* task().pipe(
      Effect.tap(() =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((completedAt) =>
            logger.ok(`${label} - ${formatElapsed(completedAt - startedAt)}`),
          ),
        ),
      ),
      Effect.tapError(() => logger.error(`${label} failed`)),
    );
  });
