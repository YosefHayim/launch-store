/**
 * Child-process execution service.
 *
 * All commands run with `shell: false` and an explicit argument array — never a concatenated
 * string — which sidesteps the shell-injection class of bug. Three operations:
 * - `streamCommand` — streams output to terminal (builds, fastlane)
 * - `captureCommand` — collects stdout for parsing
 * - `commandExists` — PATH check for `launch doctor` preflight
 *
 * Exposed as a `Context.Tag` so tests can substitute a fake without touching the filesystem.
 */

import { Context, Data, Effect, Layer } from 'effect';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mergeChildEnv } from '../terminal/locale.js';
import { redactLine } from './redact.js';

// ─── Errors ────────────────────────────────────────────────────────────────

export class CommandFailedError extends Data.TaggedError('CommandFailedError')<{
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

// ─── Options ───────────────────────────────────────────────────────────────

export interface CommandOptions {
  /** Working directory for the command. */
  workingDirectory?: string;
  /** Extra environment variables merged over `process.env`. */
  environmentOverrides?: Record<string, string>;
}

export interface QuietCommandOptions extends CommandOptions {
  /** Called once per line of combined stdout+stderr as it arrives. */
  onLine?: (line: string) => void;
  /** Append the complete combined output here. */
  logFilePath?: string;
  /** Redact secrets line-by-line before they reach the log file. */
  shouldRedactSecrets?: boolean;
}

// ─── Service Tag ───────────────────────────────────────────────────────────

export class CommandExecutor extends Context.Tag('CommandExecutor')<
  CommandExecutor,
  {
    /** Run a command, streaming stdout/stderr to the terminal. */
    readonly streamCommand: (
      command: string,
      args: readonly string[],
      options?: CommandOptions,
    ) => Effect.Effect<void, CommandFailedError>;

    /** Run a command with output piped to a log file + per-line callback. */
    readonly streamCommandQuietly: (
      command: string,
      args: readonly string[],
      options?: QuietCommandOptions,
    ) => Effect.Effect<void, CommandFailedError>;

    /** Run a command and return its trimmed stdout. */
    readonly captureCommand: (
      command: string,
      args: readonly string[],
      options?: CommandOptions,
    ) => Effect.Effect<string, CommandFailedError>;

    /** Check whether an executable is on the PATH. */
    readonly commandExists: (command: string) => Effect.Effect<boolean>;
  }
>() {}

// ─── Live Implementation ───────────────────────────────────────────────────

export const CommandExecutorLive = Layer.succeed(CommandExecutor, {
  streamCommand: (command, args, options = {}) =>
    Effect.async<void, CommandFailedError>((resume) => {
      const child = spawn(command, [...args], {
        cwd: options.workingDirectory,
        env: mergeChildEnv(options.environmentOverrides),
        stdio: 'inherit',
        shell: false,
      });
      child.on('error', (nativeError) =>
        resume(
          Effect.fail(
            new CommandFailedError({ command, exitCode: null, stderr: nativeError.message }),
          ),
        ),
      );
      child.on('close', (exitCode) => {
        if (exitCode === 0) resume(Effect.void);
        else resume(Effect.fail(new CommandFailedError({ command, exitCode, stderr: '' })));
      });
    }),

  streamCommandQuietly: (command, args, options = {}) =>
    Effect.async<void, CommandFailedError>((resume) => {
      const logStream = options.logFilePath
        ? createWriteStream(options.logFilePath, { flags: 'a' })
        : undefined;
      const child = spawn(command, [...args], {
        cwd: options.workingDirectory,
        env: mergeChildEnv(options.environmentOverrides),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });

      const shouldRedact = options.shouldRedactSecrets ?? false;
      let pendingOutput = '';

      const consumeChunk = (chunk: Buffer): void => {
        if (logStream && !shouldRedact) logStream.write(chunk);
        pendingOutput += chunk.toString();
        let newlineIndex = pendingOutput.indexOf('\n');
        while (newlineIndex !== -1) {
          const completeLine = pendingOutput.slice(0, newlineIndex);
          if (logStream && shouldRedact) logStream.write(`${redactLine(completeLine)}\n`);
          options.onLine?.(completeLine);
          pendingOutput = pendingOutput.slice(newlineIndex + 1);
          newlineIndex = pendingOutput.indexOf('\n');
        }
      };

      child.stdout?.on('data', consumeChunk);
      child.stderr?.on('data', consumeChunk);

      child.on('error', (nativeError) => {
        logStream?.end();
        resume(
          Effect.fail(
            new CommandFailedError({ command, exitCode: null, stderr: nativeError.message }),
          ),
        );
      });
      child.on('close', (exitCode) => {
        if (pendingOutput) {
          if (logStream && shouldRedact) logStream.write(redactLine(pendingOutput));
          options.onLine?.(pendingOutput);
        }
        logStream?.end();
        if (exitCode === 0) resume(Effect.void);
        else resume(Effect.fail(new CommandFailedError({ command, exitCode, stderr: '' })));
      });
    }),

  captureCommand: (command, args, options = {}) =>
    Effect.async<string, CommandFailedError>((resume) => {
      const child = spawn(command, [...args], {
        cwd: options.workingDirectory,
        env: mergeChildEnv(options.environmentOverrides),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let stdoutContent = '';
      let stderrContent = '';
      child.stdout.on('data', (chunk: Buffer) => (stdoutContent += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderrContent += chunk.toString()));
      child.on('error', (nativeError) =>
        resume(
          Effect.fail(
            new CommandFailedError({ command, exitCode: null, stderr: nativeError.message }),
          ),
        ),
      );
      child.on('close', (exitCode) => {
        if (exitCode === 0) resume(Effect.succeed(stdoutContent.trim()));
        else
          resume(
            Effect.fail(
              new CommandFailedError({ command, exitCode, stderr: stderrContent.trim() }),
            ),
          );
      });
    }),

  commandExists: (command) =>
    Effect.async<boolean>((resume) => {
      const child = spawn('which', [command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      child.on('error', () => resume(Effect.succeed(false)));
      child.on('close', (exitCode) => resume(Effect.succeed(exitCode === 0)));
    }),
});

// ─── Imperative shims (callers migrate progressively) ──────────────────────

/** Imperative shim options — use {@link CommandOptions} in new code. */
export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/** Imperative shim quiet options — use {@link QuietCommandOptions} in new code. */
export interface QuietExecOptions extends ExecOptions {
  onLine?: (line: string) => void;
  logFile?: string;
  redact?: boolean;
}

/** Imperative shim — use {@link CommandExecutor}.streamCommand in new code. */
export function run(command: string, args: string[], options: ExecOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: mergeChildEnv(options.env),
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

/** Imperative shim — use {@link CommandExecutor}.streamCommandQuietly in new code. */
export function runQuiet(
  command: string,
  args: string[],
  options: QuietExecOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const logStream = options.logFile
      ? createWriteStream(options.logFile, { flags: 'a' })
      : undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: mergeChildEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const { redact } = options;
    let pending = '';
    const consume = (chunk: Buffer): void => {
      if (logStream && !redact) logStream.write(chunk);
      pending += chunk.toString();
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        if (logStream && redact) logStream.write(`${redactLine(line)}\n`);
        options.onLine?.(line);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);

    child.on('error', (error) => {
      logStream?.end();
      reject(error);
    });
    child.on('close', (code) => {
      if (pending) {
        if (logStream && redact) logStream.write(redactLine(pending));
        options.onLine?.(pending);
      }
      logStream?.end();
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

/** Imperative shim — use {@link CommandExecutor}.captureCommand in new code. */
export function capture(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: mergeChildEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

/** Imperative shim — use {@link CommandExecutor}.commandExists in new code. */
export async function exists(command: string): Promise<boolean> {
  try {
    await capture('which', [command], {});
    return true;
  } catch {
    return false;
  }
}
