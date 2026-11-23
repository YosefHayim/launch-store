import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { InitCommandInputSchema, runInitProgram } from './init-command.ts';
function cleanup() {
  resetLaunchDirectories();
}

afterEach(cleanup);
function describeInitCommandPieceSchema() {
  function decodesTheStandaloneBoundaryUsingTheInjectedWorkingDirectory() {
    const initCommandSchema = InitCommandInputSchema({ framed: true });
    expect(initCommandSchema).toEqual({
      framed: true,
    });
  }

  it(
    'decodes the standalone boundary using the injected working directory',
    decodesTheStandaloneBoundaryUsingTheInjectedWorkingDirectory,
  );

  function decodesTheGuidedSetupBoundaryWithAnExplicitDirectory() {
    const initCommandSchema = InitCommandInputSchema({
      workingDirectory: '/workspace',
      framed: false,
    });

    expect(initCommandSchema).toEqual({ workingDirectory: '/workspace', framed: false });
  }

  it(
    'decodes the guided setup boundary with an explicit directory',
    decodesTheGuidedSetupBoundaryWithAnExplicitDirectory,
  );

  function rejectsAnExplicitUndefinedExactOptionalDirectory() {
    function callInitCommandPieceSchema() {
      return InitCommandInputSchema({
        workingDirectory: undefined,
        framed: false,
      });
    }

    expect(callInitCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional directory',
    rejectsAnExplicitUndefinedExactOptionalDirectory,
  );

  async function refusesNonInteractiveScaffoldingBeforeWritingFiles() {
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
  }

  it(
    'refuses non-interactive scaffolding before writing files',
    refusesNonInteractiveScaffoldingBeforeWritingFiles,
  );
}

describe('InitCommandInputSchema', describeInitCommandPieceSchema);
