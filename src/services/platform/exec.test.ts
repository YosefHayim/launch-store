import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UTF8_LOCALE } from '../../terminal/locale.ts';
import {
  captureCommandOutput,
  checkCommandExists,
  executeCommand,
  executeCommandQuietly,
} from './exec.ts';

describe('command execution', () => {
  it('passes the UTF-8 locale to spawned children', async () => {
    const localeText = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdout.write(`${process.env.LANG}|${process.env.LC_ALL}`)',
    ]);
    expect(localeText).toBe(`${UTF8_LOCALE.LANG}|${UTF8_LOCALE.LC_ALL}`);
  });

  it('captures trimmed stdout', async () => {
    const standardOutput = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdout.write("launch\\n")',
    ]);
    expect(standardOutput).toBe('launch');
  });

  it('closes stdin for captured commands', async () => {
    const standardOutput = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdin.on("end", () => process.stdout.write("closed")); process.stdin.resume()',
    ]);
    expect(standardOutput).toBe('closed');
  });

  it('returns a tagged error for a non-zero exit', async () => {
    let failure: unknown = null;

    try {
      await executeCommand(process.execPath, ['-e', 'process.exit(7)']);
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({ _tag: 'CommandFailed', exitCode: 7 });
  });

  it('includes stdout in CommandFailed when a captured command fails', async () => {
    let failure: unknown = null;

    try {
      await captureCommandOutput(process.execPath, [
        '-e',
        'process.stdout.write("totallyBogusKey is unknown\\n"); process.exit(1)',
      ]);
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({
      _tag: 'CommandFailed',
      exitCode: 1,
      stderr: expect.stringMatching(/totallyBogusKey is unknown/),
    });
  });

  it('includes both stdout and stderr in CommandFailed diagnostics', async () => {
    let failure: unknown = null;

    try {
      await captureCommandOutput(process.execPath, [
        '-e',
        'process.stdout.write("stdout-diag\\n"); process.stderr.write("stderr-diag\\n"); process.exit(2)',
      ]);
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({
      _tag: 'CommandFailed',
      exitCode: 2,
      stderr: expect.stringMatching(/stdout-diag/),
    });
    expect(failure).toMatchObject({ stderr: expect.stringMatching(/stderr-diag/) });
  });

  it('checks PATH through which', async () => {
    await expect(checkCommandExists('node')).resolves.toBe(true);
    await expect(checkCommandExists('launch-command-that-does-not-exist')).resolves.toBe(false);
  });
});

describe('redaction before log persistence', () => {
  it('never persists a private-key body or a JSON password', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launch-log-redaction-'));

    try {
      const logFilePath = join(directory, 'build.log');
      const beginFence = ['-----', 'BEGIN', ' PRIVATE KEY-----'].join('');
      const endFence = ['-----', 'END', ' PRIVATE KEY-----'].join('');
      const secretOutput = [
        beginFence,
        'ZHVtbXktcHJpdmF0ZS1rZXktYm9keQ==',
        endFence,
        '{"password":"dummy-json-password"}',
      ].join('\n');
      await executeCommandQuietly(
        process.execPath,
        ['-e', 'process.stdout.write(process.argv[1])', '--', secretOutput],
        { logFilePath },
      );
      const persistedLog = readFileSync(logFilePath, 'utf8');
      expect(persistedLog).not.toContain('ZHVtbXktcHJpdmF0ZS1rZXktYm9keQ==');
      expect(persistedLog).not.toContain('dummy-json-password');
      expect(persistedLog).toContain('[redacted-key-material]');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('child environment exclusions', () => {
  it('drops excluded values inherited from the parent process', async () => {
    const previous = process.env['LAUNCH_AUDIT_TOKEN'];
    process.env['LAUNCH_AUDIT_TOKEN'] = 'dummy-private-value';

    try {
      const standardOutput = await captureCommandOutput(
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify([process.env.LAUNCH_AUDIT_TOKEN, process.env.EXPO_PUBLIC_SAFE]))',
        ],
        {
          environmentOverrides: { EXPO_PUBLIC_SAFE: 'safe' },
          envExclude: ['LAUNCH_AUDIT_*'],
        },
      );
      expect(JSON.parse(standardOutput)).toEqual([null, 'safe']);
    } finally {
      if (previous == null) {
        delete process.env['LAUNCH_AUDIT_TOKEN'];
      }

      if (previous != null) {
        process.env['LAUNCH_AUDIT_TOKEN'] = previous;
      }
    }
  });
});
