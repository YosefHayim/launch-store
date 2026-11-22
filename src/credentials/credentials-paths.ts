import { join } from 'node:path';
import { readLaunchDirectories } from '../services/platform/paths.ts';

export function expandHomePath(enteredPath: string): string {
  const isHomeShorthand = enteredPath.startsWith('~');

  if (isHomeShorthand == false) {
    return enteredPath;
  }

  return join(readLaunchDirectories().homeDirectory, enteredPath.slice(1));
}

export function displayPath(absolutePath: string): string {
  const homeDirectory = readLaunchDirectories().homeDirectory;
  const isInsideHome = absolutePath.startsWith(homeDirectory);

  if (isInsideHome == false) {
    return absolutePath;
  }

  return `~${absolutePath.slice(homeDirectory.length)}`;
}
