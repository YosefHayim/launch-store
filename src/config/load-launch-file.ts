// Loads launch.config.ts from the project directory.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readLaunchFile, type LaunchFile } from './launch-file.js';

export async function loadLaunchFile(launchFilePath = 'launch.config.ts'): Promise<LaunchFile> {
  const absolutePath = resolve(launchFilePath);
  const launchFileUrl = pathToFileURL(absolutePath).href;

  var loadedModule: { default?: unknown };

  try {
    loadedModule = (await import(launchFileUrl)) as { default?: unknown };
  } catch (error) {
    throw new Error(`Could not load ${launchFilePath}.`, { cause: error });
  }

  return readLaunchFile(loadedModule.default);
}
