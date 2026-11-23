// Looks in common folders for a store key file and can delete the copy it found.

import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { displayPath } from './credentials-paths.ts';

export function credentialSearchDirectories(
  homeDirectory: string,
  workingDirectory: string,
): readonly string[] {
  return [
    join(homeDirectory, 'Downloads'),
    join(homeDirectory, '.appstoreconnect', 'private_keys'),
    join(homeDirectory, '.launch', 'credentials'),
    join(workingDirectory, 'private_keys'),
    workingDirectory,
  ];
}

export function isCredentialDiscoveryFile(
  filePath: string,
  searchDirectories: readonly string[],
): boolean {
  const parentDirectory = dirname(filePath);
  const containingDirectory = resolve(parentDirectory);

  for (const searchDirectory of searchDirectories) {
    const isSameDirectory = resolve(searchDirectory) == containingDirectory;

    if (isSameDirectory) {
      return true;
    }
  }

  return false;
}

export async function offerSourceRemoval(
  sourcePath: string,
  secretLabel: string,
  canPrompt: boolean,
): Promise<void> {
  const launchPaths = readLaunchDirectories();
  const searchDirectories = credentialSearchDirectories(
    launchPaths.homeDirectory,
    launchPaths.workingDirectory,
  );
  const isDiscoveryFile = isCredentialDiscoveryFile(sourcePath, searchDirectories);

  if (isDiscoveryFile == false) {
    return;
  }

  const logger = createLogger(false);
  const shownPath = displayPath(sourcePath);

  if (canPrompt == false) {
    logger.warn(`Plaintext ${secretLabel} remains at ${shownPath}; it is safe to remove.`);

    return;
  }

  const shouldRemove = await LaunchPrompt.confirm(
    `Remove plaintext ${secretLabel} from ${shownPath}? It is now in the secret store.`,
  );

  if (shouldRemove == false) {
    logger.line(`Kept ${shownPath}.`);

    return;
  }

  await rm(sourcePath, { force: true });
  logger.ok(`Removed ${shownPath}.`);
}
