import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/platform/paths.js';
import { readLastApp, readLastBump, readLastRun, rememberLastRun } from './lastRun.js';

/** Run remembered-choice behavior with the official Node platform services. */
const executeLastRunProgram = <Success, Failure>(
  program: Effect.Effect<Success, Failure, LaunchPathsService | NodeContext.NodeContext>,
): Promise<Success> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest('/tmp', '/tmp')),
    ),
  );
describe('lastRun - remembered build picks round-trip through a temp file', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-lastrun-'));
    file = join(dir, 'last-run.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it('reads an empty, well-formed state before anything is written', async () => {
    await expect(executeLastRunProgram(readLastRun(file))).resolves.toEqual({ apps: {} });
    await expect(executeLastRunProgram(readLastApp(file))).resolves.toBeUndefined();
    await expect(executeLastRunProgram(readLastBump('sampleapp', file))).resolves.toBeUndefined();
  });
  it('remembers the last app and its bump, then reads them back', async () => {
    await executeLastRunProgram(rememberLastRun('sampleapp', 'patch', file));
    await expect(executeLastRunProgram(readLastApp(file))).resolves.toBe('sampleapp');
    await expect(executeLastRunProgram(readLastBump('sampleapp', file))).resolves.toBe('patch');
  });
  it("updates lastApp without clobbering another app's remembered bump", async () => {
    await executeLastRunProgram(rememberLastRun('sampleapp', 'minor', file));
    await executeLastRunProgram(rememberLastRun('arcade', 'major', file));
    await expect(executeLastRunProgram(readLastApp(file))).resolves.toBe('arcade');
    await expect(executeLastRunProgram(readLastBump('sampleapp', file))).resolves.toBe('minor');
    await expect(executeLastRunProgram(readLastBump('arcade', file))).resolves.toBe('major');
  });
  it('leaves a prior bump untouched when none is applied', async () => {
    await executeLastRunProgram(rememberLastRun('sampleapp', 'patch', file));
    await executeLastRunProgram(rememberLastRun('sampleapp', undefined, file));
    await expect(executeLastRunProgram(readLastApp(file))).resolves.toBe('sampleapp');
    await expect(executeLastRunProgram(readLastBump('sampleapp', file))).resolves.toBe('patch');
  });
  it('tolerates a malformed file, reading as nothing remembered', async () => {
    writeFileSync(file, '{ not json');
    await expect(executeLastRunProgram(readLastRun(file))).resolves.toEqual({ apps: {} });
  });
});
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
