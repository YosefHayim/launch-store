import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { InitCommandInputSchema, runInitProgram } from './initCommand.js';

describe('InitCommandInputSchema', () => {
  it('decodes the standalone boundary using the injected working directory', () => {
    expect(Schema.decodeUnknownSync(InitCommandInputSchema)({ framed: true })).toEqual({
      framed: true,
    });
  });

  it('decodes the guided setup boundary with an explicit directory', () => {
    expect(
      Schema.decodeUnknownSync(InitCommandInputSchema)({
        workingDirectory: '/workspace',
        framed: false,
      }),
    ).toEqual({ workingDirectory: '/workspace', framed: false });
  });

  it('rejects an explicit undefined exact optional directory', () => {
    expect(() =>
      Schema.decodeUnknownSync(InitCommandInputSchema)({
        workingDirectory: undefined,
        framed: false,
      }),
    ).toThrow();
  });

  it('refuses non-interactive scaffolding before writing files', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-init-command-'));
    try {
      await expect(
        Effect.runPromise(
          runInitProgram({ framed: false }).pipe(
            Effect.provide(makeLaunchPathsTest(temporaryDirectory, temporaryDirectory)),
            Effect.provide(makeLaunchPromptTest()),
            Effect.provide(makeLaunchLoggerTest([])),
            Effect.provide(NodeContext.layer),
          ),
        ),
      ).rejects.toThrow(/interactive terminal/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
