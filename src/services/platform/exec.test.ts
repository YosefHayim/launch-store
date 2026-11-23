import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UTF8_LOCALE } from '@/terminal/locale.js';
import {
  captureCommandOutput,
  checkCommandExists,
  executeCommand,
  executeCommandQuietly,
} from './exec.ts';

function describeCommandExecution() {
  async function passesTheUTF8LocaleToSpawnedChildren() {
    const localeText = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdout.write(`${process.env.LANG}|${process.env.LC_ALL}`)',
    ]);

    expect(localeText).toBe(`${UTF8_LOCALE.LANG}|${UTF8_LOCALE.LC_ALL}`);
  }

  it('passes the UTF-8 locale to spawned children', passesTheUTF8LocaleToSpawnedChildren);

  async function capturesTrimmedStdout() {
    const standardOutput = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdout.write("launch\\n")',
    ]);

    expect(standardOutput).toBe('launch');
  }

  it('captures trimmed stdout', capturesTrimmedStdout);

  async function closesStdinForCapturedCommands() {
    const standardOutput = await captureCommandOutput(process.execPath, [
      '-e',
      'process.stdin.on("end", () => process.stdout.write("closed")); process.stdin.resume()',
    ]);

    expect(standardOutput).toBe('closed');
  }

  it('closes stdin for captured commands', closesStdinForCapturedCommands);

  async function returnsATaggedErrorForANonZeroExit() {
    let failure: unknown = null;

    try {
      await executeCommand(process.execPath, ['-e', 'process.exit(7)']);
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({ _tag: 'CommandFailed', exitCode: 7 });
  }

  it('returns a tagged error for a non-zero exit', returnsATaggedErrorForANonZeroExit);

  async function includesStdoutInCommandFailedWhenACapturedCommandFails() {
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
  }

  it(
    'includes stdout in CommandFailed when a captured command fails',
    includesStdoutInCommandFailedWhenACapturedCommandFails,
  );

  async function includesBothStdoutAndStderrInCommandFailedDiagnostics() {
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
  }

  it(
    'includes both stdout and stderr in CommandFailed diagnostics',
    includesBothStdoutAndStderrInCommandFailedDiagnostics,
  );

  async function checksPATHThroughWhich() {
    const commandExists = checkCommandExists('node');
    await expect(commandExists).resolves.toBe(true);
    await expect(checkCommandExists('launch-command-that-does-not-exist')).resolves.toBe(false);
  }

  it('checks PATH through which', checksPATHThroughWhich);
}

describe('command execution', describeCommandExecution);

function describeRedactionBeforeLogPersistence() {
  async function neverPersistsAPrivateKeyPieceOrAJSONPassword() {
    const systemTemporaryDirectory = tmpdir();
    const launchLogRedactionPath = join(systemTemporaryDirectory, 'launch-log-redaction-');
    const directory = mkdtempSync(launchLogRedactionPath);

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
  }

  it(
    'never persists a private-key body or a JSON password',
    neverPersistsAPrivateKeyPieceOrAJSONPassword,
  );
}

describe('redaction before log persistence', describeRedactionBeforeLogPersistence);

function describeChildEnvironmentExclusions() {
  async function dropsExcludedValuesInheritedFromTheParentProcess() {
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
      const parsed = JSON.parse(standardOutput);

      expect(parsed).toEqual([null, 'safe']);
    } finally {
      if (previous == null) {
        delete process.env['LAUNCH_AUDIT_TOKEN'];
      }

      if (previous != null) {
        process.env['LAUNCH_AUDIT_TOKEN'] = previous;
      }
    }
  }

  it(
    'drops excluded values inherited from the parent process',
    dropsExcludedValuesInheritedFromTheParentProcess,
  );

  async function dropsASecretLookingParentValueUnlessOverridden() {
    const previous = process.env['LAUNCH_AUDIT_TOKEN'];

    process.env['LAUNCH_AUDIT_TOKEN'] = 'dummy-private-value';

    try {
      const inherited = await captureCommandOutput(process.execPath, [
        '-e',
        'process.stdout.write(String(process.env.LAUNCH_AUDIT_TOKEN ?? "missing"))',
      ]);
      const overridden = await captureCommandOutput(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.env.LAUNCH_AUDIT_TOKEN ?? "missing"))'],
        { environmentOverrides: { LAUNCH_AUDIT_TOKEN: 'dummy-override' } },
      );

      expect(inherited).toBe('missing');
      expect(overridden).toBe('dummy-override');
    } finally {
      if (previous == null) {
        delete process.env['LAUNCH_AUDIT_TOKEN'];
      }

      if (previous != null) {
        process.env['LAUNCH_AUDIT_TOKEN'] = previous;
      }
    }
  }

  it(
    'drops a secret-looking parent value unless it is an override',
    dropsASecretLookingParentValueUnlessOverridden,
  );
}

describe('child environment exclusions', describeChildEnvironmentExclusions);
