import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function createTemporaryHomeDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'launch-store-test-'));
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

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, fileText);
}
