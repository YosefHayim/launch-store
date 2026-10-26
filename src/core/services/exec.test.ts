import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { UTF8_LOCALE } from '../terminal/locale.js';
import {
  captureCommandOutput,
  checkCommandExists,
  executeCommand,
  provideNodeCommandServices,
} from './exec.js';
/** Execute a command service test with the official Node platform services. */
const executeTestProgram = <TValue, TError>(
  program: Parameters<typeof provideNodeCommandServices<TValue, TError>>[0],
): Promise<TValue> => Effect.runPromise(provideNodeCommandServices(program));
describe('Effect Platform command execution', () => {
  it('passes the UTF-8 locale to spawned children', async () => {
    const localeText = await executeTestProgram(
      captureCommandOutput(process.execPath, [
        '-e',
        'process.stdout.write(`${process.env.LANG}|${process.env.LC_ALL}`)',
      ]),
    );
    expect(localeText).toBe(`${UTF8_LOCALE.LANG}|${UTF8_LOCALE.LC_ALL}`);
  });
  it('captures trimmed stdout', async () => {
    const standardOutput = await executeTestProgram(
      captureCommandOutput(process.execPath, ['-e', 'process.stdout.write("launch\\n")']),
    );
    expect(standardOutput).toBe('launch');
  });
  it('closes stdin for captured commands', async () => {
    const standardOutput = await executeTestProgram(
      captureCommandOutput(process.execPath, [
        '-e',
        'process.stdin.on("end", () => process.stdout.write("closed")); process.stdin.resume()',
      ]),
    );
    expect(standardOutput).toBe('closed');
  });
  it('returns a tagged error for a non-zero exit', async () => {
    const failure = await Effect.runPromise(
      provideNodeCommandServices(
        executeCommand(process.execPath, ['-e', 'process.exit(7)']).pipe(Effect.flip),
      ),
    );
    expect(failure._tag).toBe('CommandFailed');
    expect(failure.exitCode).toBe(7);
  });
  it('includes stdout in CommandFailed when a captured command fails', async () => {
    const failure = await Effect.runPromise(
      provideNodeCommandServices(
        captureCommandOutput(process.execPath, [
          '-e',
          'process.stdout.write("totallyBogusKey is unknown\\n"); process.exit(1)',
        ]).pipe(Effect.flip),
      ),
    );
    expect(failure._tag).toBe('CommandFailed');
    expect(failure.exitCode).toBe(1);
    expect(failure.stderr).toMatch(/totallyBogusKey is unknown/);
  });
  it('includes both stdout and stderr in CommandFailed diagnostics', async () => {
    const failure = await Effect.runPromise(
      provideNodeCommandServices(
        captureCommandOutput(process.execPath, [
          '-e',
          'process.stdout.write("stdout-diag\\n"); process.stderr.write("stderr-diag\\n"); process.exit(2)',
        ]).pipe(Effect.flip),
      ),
    );
    expect(failure._tag).toBe('CommandFailed');
    expect(failure.exitCode).toBe(2);
    expect(failure.stderr).toMatch(/stdout-diag/);
    expect(failure.stderr).toMatch(/stderr-diag/);
  });
  it('checks PATH through the platform command executor', async () => {
    await expect(executeTestProgram(checkCommandExists('node'))).resolves.toBe(true);
    await expect(
      executeTestProgram(checkCommandExists('launch-command-that-does-not-exist')),
    ).resolves.toBe(false);
  });
});

describe('redaction before log persistence', () => {
  it('never persists a private-key body or a JSON password', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { executeCommandQuietly } = await import('./exec.js');
    const directory = mkdtempSync(join(tmpdir(), 'launch-log-redaction-'));
    try {
      const logFilePath = join(directory, 'build.log');
      const beginFence = ['-----', 'BEGIN', ' PRIVATE KEY-----'].join('');
      const endFence = ['-----', 'END', ' PRIVATE KEY-----'].join('');
      const secretOutput = [
        beginFence,
        'dummy-private-key-body',
        endFence,
        '{"password":"dummy-json-password"}',
      ].join('\n');
      await executeTestProgram(
        executeCommandQuietly(
          process.execPath,
          ['-e', 'process.stdout.write(process.argv[1])', '--', secretOutput],
          { logFilePath },
        ),
      );
      const persistedLog = readFileSync(logFilePath, 'utf8');
      expect(persistedLog).not.toContain('dummy-private-key-body');
      expect(persistedLog).not.toContain('dummy-json-password');
      expect(persistedLog).toContain('[redacted-key-material]');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
