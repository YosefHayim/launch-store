import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function createTemporaryHomeDirectory(): string {
  const systemTemporaryDirectory = tmpdir();
  const launchStoreTestPath = join(systemTemporaryDirectory, 'launch-store-test-');
  return mkdtempSync(launchStoreTestPath);
}

export function removeTemporaryHomeDirectory(homeDirectory: string): void {
  rmSync(homeDirectory, { recursive: true, force: true });
}

export function writeLaunchHomeFile(
  homeDirectory: string,
  relativePath: string,
  fileText: string,
): void {
  const filePath = join(homeDirectory, '.launch', relativePath);

  const parentDirectory = dirname(filePath);

  mkdirSync(parentDirectory, { recursive: true });
  writeFileSync(filePath, fileText);
}
