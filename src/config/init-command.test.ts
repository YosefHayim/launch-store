import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { InitCommandInputSchema, runInitProgram } from './init-command.ts';

afterEach(() => {
  resetLaunchDirectories();
});

describe('InitCommandInputSchema', () => {
  it('decodes the standalone boundary using the injected working directory', () => {
    const initCommandSchema = InitCommandInputSchema({ framed: true });
    expect(initCommandSchema).toEqual({
      framed: true,
    });
  });

  it('decodes the guided setup boundary with an explicit directory', () => {
    const initCommandSchema = InitCommandInputSchema({
      workingDirectory: '/workspace',
      framed: false,
    });
    expect(initCommandSchema).toEqual({ workingDirectory: '/workspace', framed: false });
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
    const systemTemporaryDirectory = tmpdir();
    const launchInitCommandPath = join(systemTemporaryDirectory, 'launch-init-command-');
    const temporaryDirectory = mkdtempSync(launchInitCommandPath);
    useLaunchDirectories({
      homeDirectory: temporaryDirectory,
      workingDirectory: temporaryDirectory,
    });
    try {
      const initProgram = runInitProgram({ framed: false });
      await expect(initProgram).rejects.toThrow(/interactive terminal/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
