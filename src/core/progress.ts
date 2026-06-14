/**
 * Spinner-driven progress for long external tools (xcodebuild, gradle, expo prebuild).
 *
 * The underlying tools emit thousands of lines; streaming them raw buries the signal in noise. This
 * module runs the tool with its output piped instead, showing ONE animated line — the current step
 * plus elapsed time — while teeing the full output to a log file. On failure it prints the captured
 * tail and the log path so nothing is lost. It deliberately degrades to raw streaming (the previous
 * behavior) when the output isn't an interactive TTY, in CI, or under `--verbose`, so logs, pipes,
 * and scripts keep the complete, unbuffered record.
 */

import { spinner } from "@clack/prompts";
import { join } from "node:path";
import { run, runQuiet, type ExecOptions } from "./exec.js";
import { ensureDir, LOGS_DIR } from "./paths.js";

/** Process-wide toggle: when true, `runWithProgress` streams the raw tool output instead of a spinner. */
let streamRawOutput = false;

/** Set by the CLI's `--verbose` flag — makes every {@link runWithProgress} stream the full tool output. */
export function setVerboseOutput(verbose: boolean): void {
  streamRawOutput = verbose;
}

/**
 * Whether to render a spinner or stream raw output. Pure so the decision is unit-testable. A spinner
 * needs a real interactive TTY that isn't CI and hasn't asked for verbose output; everything else
 * gets the raw stream so the full log survives in transcripts.
 */
export function selectProgressMode(isTTY: boolean, env: NodeJS.ProcessEnv, verbose: boolean): "spinner" | "stream" {
  if (verbose || !isTTY || env["CI"]) return "stream";
  return "spinner";
}

/** Options for {@link runWithProgress}. */
export interface ProgressRunOptions extends ExecOptions {
  /** The headline shown on the spinner, e.g. `"Building iOS · Looopi"`. */
  label: string;
  /** Map a raw output line to a short status appended after the label; return undefined to ignore it. */
  parseStep?: (line: string) => string | undefined;
}

/** Trailing lines kept in memory to show as context when a tool fails. */
const TAIL_LINES = 40;

/** Cap a step string so the spinner stays on one terminal line. */
function truncateStep(step: string): string {
  const max = 52;
  return step.length > max ? `${step.slice(0, max - 1)}…` : step;
}

/** Format an elapsed millisecond span as `"45s"` or `"2m 04s"`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

/**
 * Pull a compact step out of an xcpretty line. xcpretty prefixes each build step with `▸`
 * (e.g. `[02:56:43]: ▸ Compiling yuv_sse2.c`), so we surface the text after it.
 */
export function xcodeProgressStep(line: string): string | undefined {
  const match = /▸\s*(.+)/.exec(line);
  return match?.[1] ? truncateStep(match[1].trim()) : undefined;
}

/**
 * Pull a compact step out of a Gradle line. Gradle announces work as `> Task :app:bundleRelease`,
 * so we surface the task path; bundletool/other lines are ignored.
 */
export function gradleProgressStep(line: string): string | undefined {
  const match = /^> Task (\S+)/.exec(line.trim());
  return match?.[1] ? truncateStep(match[1]) : undefined;
}

/** A safe-for-a-filename slug of a label, e.g. `"Building iOS · Looopi"` → `"building-ios-looopi"`. */
function logSlug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "run"
  );
}

/** A filesystem-safe timestamp, e.g. `2026-06-14T02-56-32`. */
function logStamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
}

/** Print a failed tool's captured tail and the path to its full log. */
function reportFailure(label: string, tail: string[], logFile: string): void {
  console.error(`\n${label} failed. Last lines:`);
  for (const line of tail) console.error(`  ${line}`);
  console.error(`\nFull log: ${logFile}`);
}

/**
 * Run a long external tool under a spinner (or stream it raw — see {@link selectProgressMode}).
 *
 * In spinner mode the full output is tee'd to a per-run file under {@link LOGS_DIR}; the spinner
 * shows the live step from `parseStep` and a running clock; on failure the tail and log path are
 * printed before the error propagates. In stream mode it is exactly {@link run} (inherited stdio).
 */
export async function runWithProgress(command: string, args: string[], options: ProgressRunOptions): Promise<void> {
  const { label, parseStep, ...exec } = options;

  if (selectProgressMode(process.stdout.isTTY, process.env, streamRawOutput) === "stream") {
    return run(command, args, exec);
  }

  const logFile = join(ensureDir(LOGS_DIR), `${logSlug(label)}-${logStamp()}.log`);
  const startedAt = Date.now();
  const tail: string[] = [];
  let step = "";

  const progress = spinner();
  const render = (): void => {
    progress.message(`${label}${step ? ` · ${step}` : ""}   ${formatElapsed(Date.now() - startedAt)}`);
  };
  const clock = setInterval(render, 1000);
  clock.unref(); // never let the elapsed ticker hold the process open
  progress.start(`${label}…`);

  try {
    await runQuiet(command, args, {
      ...exec,
      logFile,
      onLine: (line) => {
        tail.push(line);
        if (tail.length > TAIL_LINES) tail.shift();
        const next = parseStep?.(line);
        if (next) {
          step = next;
          render();
        }
      },
    });
    clearInterval(clock);
    progress.stop(`${label} · ${formatElapsed(Date.now() - startedAt)}`);
  } catch (error) {
    clearInterval(clock);
    progress.error(`${label} failed`);
    reportFailure(label, tail, logFile);
    throw error;
  }
}

/**
 * Whether we can safely prompt the user: a real interactive TTY that isn't a CI runner. Drives the
 * pre-upload confirmation — in CI or a pipe we never block on stdin; we proceed and log instead. Args
 * default to the live process but are injectable so the decision is unit-testable (like
 * {@link selectProgressMode}).
 */
export function isInteractive(isTTY = process.stdout.isTTY, env: NodeJS.ProcessEnv = process.env): boolean {
  return isTTY && !env["CI"];
}

/**
 * Run a silent async step under a spinner so long network round-trips (App Store Connect / Google
 * Play lookups, the TestFlight processing poll) don't show a frozen screen. Degrades to a plain
 * awaited call — no animation — whenever {@link selectProgressMode} picks "stream" (non-TTY, CI, or
 * `--verbose`), so logs and scripts stay clean. Unlike {@link runWithProgress} it drives no child
 * process; it just awaits `task` while telling the user what's happening.
 */
export async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (selectProgressMode(process.stdout.isTTY, process.env, streamRawOutput) === "stream") {
    return task();
  }

  const startedAt = Date.now();
  const progress = spinner();
  const clock = setInterval(() => {
    progress.message(`${label}   ${formatElapsed(Date.now() - startedAt)}`);
  }, 1000);
  clock.unref();
  progress.start(`${label}…`);

  try {
    const result = await task();
    clearInterval(clock);
    progress.stop(`${label} · ${formatElapsed(Date.now() - startedAt)}`);
    return result;
  } catch (error) {
    clearInterval(clock);
    progress.error(`${label} failed`);
    throw error;
  }
}
