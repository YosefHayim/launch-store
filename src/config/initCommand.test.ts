import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.js';
import { InitCommandInputSchema, runInitProgram } from './initCommand.js';

afterEach(() => {
  resetLaunchDirectories();
});

describe('InitCommandInputSchema', () => {
  it('decodes the standalone boundary using the injected working directory', () => {
    expect(InitCommandInputSchema({ framed: true })).toEqual({
      framed: true,
    });
  });

  it('decodes the guided setup boundary with an explicit directory', () => {
    expect(
      InitCommandInputSchema({
        workingDirectory: '/workspace',
        framed: false,
      }),
    ).toEqual({ workingDirectory: '/workspace', framed: false });
  });

  it('rejects an explicit undefined exact optional directory', () => {
    expect(() =>
      InitCommandInputSchema({
        workingDirectory: undefined,
        framed: false,
      }),
    ).toThrow();
  });

  it('refuses non-interactive scaffolding before writing files', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-init-command-'));
    useLaunchDirectories({
      homeDirectory: temporaryDirectory,
      workingDirectory: temporaryDirectory,
    });
    try {
      await expect(runInitProgram({ framed: false })).rejects.toThrow(/interactive terminal/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
