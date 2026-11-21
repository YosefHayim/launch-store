import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/platform/paths.js';
import { readFirstRunState } from './firstRun.js';

let temporaryHome: string;

/** Run first-run state behavior against an isolated Effect Platform home directory. */
const executeFirstRunProgram = <Success, Failure>(
  program: Effect.Effect<Success, Failure, LaunchPathsService | NodeContext.NodeContext>,
): Promise<Success> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(makeLaunchPathsTest(temporaryHome, temporaryHome)),
      Effect.provide(NodeContext.layer),
    ),
  );

beforeEach(() => {
  temporaryHome = mkdtempSync(join(tmpdir(), 'launch-first-run-'));
});

afterEach(() => {
  rmSync(temporaryHome, { recursive: true, force: true });
});

describe('first-run state', () => {
  it('reads as unseen when the state file does not exist', async () => {
    await expect(executeFirstRunProgram(readFirstRunState())).resolves.toEqual({});
  });

  it('treats malformed state as unseen', async () => {
    const launchHome = join(temporaryHome, '.launch');
    const stateFile = join(launchHome, 'state.json');
    mkdirSync(launchHome, { recursive: true });
    writeFileSync(stateFile, '{ not json');
    await expect(executeFirstRunProgram(readFirstRunState())).resolves.toEqual({});
  });
});
