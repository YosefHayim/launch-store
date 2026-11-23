import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { readFirstRunState } from './first-run.ts';

let temporaryHome: string;
function prepare() {
  const systemTemporaryDirectory = tmpdir();
  const launchFirstRunPath = join(systemTemporaryDirectory, 'launch-first-run-');
  temporaryHome = mkdtempSync(launchFirstRunPath);
  useLaunchDirectories({ homeDirectory: temporaryHome, workingDirectory: temporaryHome });
}

beforeEach(prepare);
function cleanup() {
  resetLaunchDirectories();
  rmSync(temporaryHome, { recursive: true, force: true });
}

afterEach(cleanup);
function describeFirstRunPiece() {
  async function readsAsUnseenWhenThePieceFileDoesNotExist() {
    const readFirstRun = readFirstRunState();
    await expect(readFirstRun).resolves.toEqual({});
  }

  it(
    'reads as unseen when the state file does not exist',
    readsAsUnseenWhenThePieceFileDoesNotExist,
  );

  async function treatsMalformedPieceAsUnseen() {
    const launchHome = join(temporaryHome, '.launch');
    const stateFile = join(launchHome, 'state.json');

    mkdirSync(launchHome, { recursive: true });
    writeFileSync(stateFile, '{ not json');

    const readFirstRun = readFirstRunState();

    await expect(readFirstRun).resolves.toEqual({});
  }

  it('treats malformed state as unseen', treatsMalformedPieceAsUnseen);
}

describe('first-run state', describeFirstRunPiece);
