// Runs a child program, captures its output, and keeps secrets out of what gets printed.

import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isEnvExcluded, isSecretLookingName } from '@/config/environment-file.js';
import { mergeChildEnv } from '@/terminal/locale.js';
import { readLaunchEnvironment } from './environment.ts';
import { isJsonOutput } from './json-output-mode.ts';
import { makeLogRedactor, redactText } from './redact.ts';

export type CommandFailed = Readonly<{
  _tag: 'CommandFailed';
  command: string;
  exitCode: number | null;
  stderr: string;
  cause?: unknown;
}>;

export function makeCommandFailed(fields: {
  command: string;
  exitCode: number | null;
  stderr: string;
  cause?: unknown;
}): CommandFailed {
  return {
    _tag: 'CommandFailed',
    command: fields.command,
    exitCode: fields.exitCode,
    stderr: fields.stderr,
    cause: fields.cause,
  };
}

let inheritedExclusions: readonly string[] = [];

export function setCommandEnvironmentExclusions(exclusions: readonly string[]): void {
  inheritedExclusions = exclusions;
}

export type CommandExecutionOptions = Readonly<{
  workingDirectory?: string;
  environmentOverrides?: Record<string, string>;
  envExclude?: readonly string[];
}>;

type QuietCommandExecutionOptions = CommandExecutionOptions &
  Readonly<{
    onLine?: (line: string) => void;
    logFilePath?: string;
  }>;

function commandPlatformFailure(executable: string, cause: unknown): CommandFailed {
  const asString = String(cause);
  const redact = redactText(asString);

  return makeCommandFailed({
    command: executable,
    exitCode: null,
    stderr: redact,
    cause,
  });
}

function checkExitCode(executable: string, exitCode: number | null, standardError: string): void {
  const isSuccess = exitCode == 0;

  if (isSuccess) {
    return;
  }

  const redact = redactText(standardError);

  throw makeCommandFailed({
    command: executable,
    exitCode,
    stderr: redact,
  });
}

function combineCapturedDiagnostics(standardOutput: string, standardError: string): string {
  const trimmedOutput = standardOutput.trim();
  const trimmedError = standardError.trim();

  if (trimmedOutput.length == 0) {
    return trimmedError;
  }

  if (trimmedError.length == 0) {
    return trimmedOutput;
  }

  return `${trimmedOutput}\n${trimmedError}`;
}

function isExplicitOverride(overrides: Record<string, string> | undefined, name: string): boolean {
  if (overrides == null) {
    return false;
  }

  return Object.hasOwn(overrides, name);
}

function shouldDropInheritedSecret(
  name: string,
  overrides: Record<string, string> | undefined,
): boolean {
  const looksSecret = isSecretLookingName(name);

  if (looksSecret == false) {
    return false;
  }

  return isExplicitOverride(overrides, name) == false;
}

function childEnvironment(commandOptions: CommandExecutionOptions): NodeJS.ProcessEnv {
  const environment = readLaunchEnvironment();
  const overrides = commandOptions.environmentOverrides;
  const merged = mergeChildEnv(environment.rawVariables, overrides);
  let exclusions = inheritedExclusions;

  if (commandOptions.envExclude != null) {
    exclusions = commandOptions.envExclude;
  }

  const filtered: NodeJS.ProcessEnv = {};

  for (const name of Object.keys(merged)) {
    const isExcluded = isEnvExcluded(name, exclusions);

    if (isExcluded) {
      continue;
    }

    const dropSecret = shouldDropInheritedSecret(name, overrides);

    if (dropSecret) {
      continue;
    }

    const variable = merged[name];

    if (variable == null) {
      continue;
    }

    filtered[name] = variable;
  }

  return filtered;
}

type CapturedProcess = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}>;

function appendChunk(chunks: Buffer[], chunk: Buffer | string): void {
  if (typeof chunk == 'string') {
    const bufferBytes = Buffer.from(chunk);
    chunks.push(bufferBytes);
    return;
  }

  chunks.push(chunk);
}

function waitForExit(child: ChildProcess, executable: string): Promise<number | null> {
  return new Promise((finish, fail) => {
    child.once('exit', function finishOnExit(code: number | null) {
      finish(code);
    });
    child.once('error', function failOnSpawn(cause: unknown) {
      fail(commandPlatformFailure(executable, cause));
    });
  });
}

async function captureProcess(child: ChildProcess, executable: string): Promise<CapturedProcess> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout?.on('data', function keepStdout(chunk: Buffer | string) {
    appendChunk(stdoutChunks, chunk);
  });
  child.stderr?.on('data', function keepStderr(chunk: Buffer | string) {
    appendChunk(stderrChunks, chunk);
  });

  const exitCode = await waitForExit(child, executable);

  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

function startProcess(
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions,
  stdio: 'inherit' | 'pipe',
): ChildProcess {
  return spawn(executable, [...commandArguments], {
    cwd: commandOptions.workingDirectory,
    env: childEnvironment(commandOptions),
    stdio,
  });
}

export async function executeCommand(
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions = {},
): Promise<void> {
  const shouldHideOutput = isJsonOutput();

  if (shouldHideOutput) {
    const child = startProcess(executable, commandArguments, commandOptions, 'pipe');

    child.stdin?.end();

    const captured = await captureProcess(child, executable);

    checkExitCode(executable, captured.exitCode, captured.stderr.trim());

    return;
  }

  function writeRedactedLine(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  await executeCommandQuietly(executable, commandArguments, {
    ...commandOptions,
    onLine: writeRedactedLine,
  });
}

export async function captureCommandOutput(
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions = {},
): Promise<string> {
  const child = startProcess(executable, commandArguments, commandOptions, 'pipe');

  child.stdin?.end();

  const captured = await captureProcess(child, executable);
  const diagnostics = combineCapturedDiagnostics(captured.stdout, captured.stderr);

  checkExitCode(executable, captured.exitCode, diagnostics);

  return captured.stdout.trim();
}

function takeCompleteLines(
  pending: { text: string },
  chunk: string,
  onLine: (line: string) => void,
): void {
  pending.text += chunk;

  let newlineAt = pending.text.indexOf('\n');

  while (newlineAt != -1) {
    const line = pending.text.slice(0, newlineAt).replace(/\r$/, '');
    pending.text = pending.text.slice(newlineAt + 1);
    onLine(line);
    newlineAt = pending.text.indexOf('\n');
  }
}

export async function executeCommandQuietly(
  executable: string,
  commandArguments: readonly string[],
  commandOptions: QuietCommandExecutionOptions = {},
): Promise<void> {
  const child = startProcess(executable, commandArguments, commandOptions, 'pipe');

  child.stdin?.end();

  const redactOutputLine = makeLogRedactor();
  const writes: Promise<void>[] = [];
  const stdoutPending = { text: '' };
  const stderrPending = { text: '' };

  async function keepLine(line: string): Promise<void> {
    const persistedLine = redactOutputLine(line);

    if (commandOptions.onLine != null) {
      commandOptions.onLine(persistedLine);
    }

    if (commandOptions.logFilePath == null) {
      return;
    }

    await writeFile(commandOptions.logFilePath, `${persistedLine}\n`, { flag: 'a', mode: 0o600 });
  }

  function queueLine(line: string): void {
    writes.push(keepLine(line));
  }

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', function keepStdout(chunk: string) {
    takeCompleteLines(stdoutPending, chunk, queueLine);
  });
  child.stderr?.on('data', function keepStderr(chunk: string) {
    takeCompleteLines(stderrPending, chunk, queueLine);
  });

  const exitCode = await waitForExit(child, executable);

  if (stdoutPending.text.length > 0) {
    writes.push(keepLine(stdoutPending.text));
  }

  if (stderrPending.text.length > 0) {
    writes.push(keepLine(stderrPending.text));
  }

  await Promise.all(writes);
  checkExitCode(executable, exitCode, '');
}

export async function checkCommandExists(executable: string): Promise<boolean> {
  try {
    await captureCommandOutput('which', [executable]);
  } catch (error) {
    const isMissing = error != null;

    if (isMissing) {
      return false;
    }

    throw error;
  }

  return true;
}
