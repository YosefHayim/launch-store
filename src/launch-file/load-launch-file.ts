import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LaunchConfig } from '../types/config.ts';
import { importTypeScriptModule } from '../config/import-typescript-module.ts';
import { CheckLaunchFile } from './check-launch-file.ts';
import { pathExists } from '../path-exists.ts';

export class LoadLaunchFile {
  constructor(private readonly checker = new CheckLaunchFile()) {}

  async read(startDirectory: string): Promise<LaunchConfig> {
    const launchFilePath = await this.find(startDirectory);
    const runningCopyPath = fileURLToPath(new URL('../index.js', import.meta.url));

    try {
      var importedLaunchFile = await importTypeScriptModule(launchFilePath, runningCopyPath);
    } catch (error) {
      throw new Error(`Could not load ${launchFilePath}`, { cause: error });
    }

    return this.checker.check(importedLaunchFile, launchFilePath);
  }

  private async find(startDirectory: string): Promise<string> {
    let directory = startDirectory;
    const maxParentHops = 20;

    for (let hop = 0; hop < maxParentHops; hop += 1) {
      const foundPath = await this.findInDirectory(directory);

      const isFound = foundPath != null;

      if (isFound) {
        return foundPath;
      }

      const parent = dirname(directory);

      const isRoot = parent == directory;

      if (isRoot) {
        throw new Error('No launch.config.ts in this directory or its parents');
      }

      directory = parent;
    }

    throw new Error('No launch.config.ts in this directory or its parents');
  }

  private async findInDirectory(directory: string): Promise<string | null> {
    for (const fileName of ['launch.config.ts', 'launch.config.mjs', 'launch.config.js']) {
      const candidate = join(directory, fileName);

      const exists = await pathExists(candidate);

      if (exists) {
        return candidate;
      }
    }

    return null;
  }
}
