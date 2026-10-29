import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Layer } from 'effect';
import { makeLaunchPathsTest, type LaunchPathsService } from '../core/services/paths.js';

export const createTemporaryHomeDirectory = (): string =>
  mkdtempSync(join(tmpdir(), 'launch-store-test-'));

export const removeTemporaryHomeDirectory = (homeDirectory: string): void => {
  rmSync(homeDirectory, { recursive: true, force: true });
};

export const makeLaunchHomeTest = (
  homeDirectory: string,
): Layer.Layer<LaunchPathsService | Layer.Layer.Success<typeof NodeContext.layer>> =>
  Layer.merge(NodeContext.layer, makeLaunchPathsTest(homeDirectory, join(homeDirectory, 'work')));

export const writeLaunchHomeFile = (
  homeDirectory: string,
  relativePath: string,
  fileText: string,
): void => {
  const filePath = join(homeDirectory, '.launch', relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fileText);
};
