/**
 * Thin, safe wrappers around child processes.
 *
 * All commands run with `shell: false` and an explicit argument array — never a concatenated
 * string — which sidesteps the shell-injection class of bug (and the DEP0190 warning the old
 * build script emitted). `run` streams output for long builds; `capture` collects it for parsing.
 */

import { spawn } from "node:child_process";

/** Options shared by {@link run} and {@link capture}. */
export interface ExecOptions {
  /** Working directory for the command. Defaults to the current directory. */
  cwd?: string;
  /** Extra environment variables merged over `process.env`. */
  env?: Record<string, string>;
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
