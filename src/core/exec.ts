/**
 * Thin, safe wrappers around child processes.
 *
 * All commands run with `shell: false` and an explicit argument array — never a concatenated
 * string — which sidesteps the shell-injection class of bug (and the DEP0190 warning the old
 * build script emitted). `run` streams output for long builds; `capture` collects it for parsing;
 * `runQuiet` pipes output to a log file + a per-line callback so a spinner can hide the noise.
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { redactLine } from "./redact.js";

/** Options shared by {@link run} and {@link capture}. */
export interface ExecOptions {
  /** Working directory for the command. Defaults to the current directory. */
  cwd?: string;
  /** Extra environment variables merged over `process.env`. */
  env?: Record<string, string>;
}

/** Extra options for {@link runQuiet}: where to tee the full output and how to observe it live. */
export interface QuietExecOptions extends ExecOptions {
  /** Called once per line of combined stdout+stderr as it arrives — used to drive a spinner. */
  onLine?: (line: string) => void;
  /** Append the complete combined output here (the file is created/opened in append mode). */
  logFile?: string;
  /**
   * Redact secrets line-by-line before they reach {@link logFile} (see `core/redact.ts`). Used for the
   * shareable per-build log; left off for transient per-step logs, which keep raw chunk writes. Implies
   * the tee normalizes line endings to `\n` (it writes whole redacted lines, not raw chunks).
   */
  redact?: boolean;
}

/**
 * Run a command, streaming its stdout/stderr to the terminal (for builds, prebuild, fastlane).
 * Resolves on exit code 0, rejects with a descriptive error otherwise.
 */
export function run(command: string, args: string[], options: ExecOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/**
 * Run a command with its output piped (not inherited): each line is forwarded to `onLine` and the
 * full stream is tee'd to `logFile`. Nothing is printed directly, so a caller can render a spinner
 * over the top and keep the complete log on disk for debugging. Resolves on exit 0, rejects with the
 * exit code otherwise (the caller owns surfacing the captured tail).
 */
export function runQuiet(command: string, args: string[], options: QuietExecOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const logStream = options.logFile ? createWriteStream(options.logFile, { flags: "a" }) : undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    // Buffer across chunks so `onLine` always receives whole lines, never a split fragment. When
    // redacting we tee whole (scrubbed) lines instead of raw chunks, so a secret can never straddle a
    // chunk boundary and slip through un-redacted.
    const { redact } = options;
    let pending = "";
    const consume = (chunk: Buffer): void => {
      if (logStream && !redact) logStream.write(chunk);
      pending += chunk.toString();
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        if (logStream && redact) logStream.write(`${redactLine(line)}\n`);
        options.onLine?.(line);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);

    child.on("error", (error) => {
      logStream?.end();
      reject(error);
    });
    child.on("close", (code) => {
      if (pending) {
        if (logStream && redact) logStream.write(redactLine(pending));
        options.onLine?.(pending);
      }
      logStream?.end();
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Run a command and return its trimmed stdout. Rejects on a non-zero exit. */
export function capture(command: string, args: string[], options: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

/** Return whether an executable is on the PATH — used by `launch doctor` preflight checks. */
export async function exists(command: string): Promise<boolean> {
  try {
    await capture("which", [command], {});
    return true;
  } catch {
    return false;
  }
}
