import { basename } from 'node:path';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { LaunchConfig } from '../types/config.ts';

export class CheckLaunchFile {
  check(importedLaunchFile: unknown, launchFilePath: string): LaunchConfig {
    const fileName = basename(launchFilePath);
    const loadedModule = readPlainObject(importedLaunchFile);

    if (loadedModule == null) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const launchFile = readPlainObject(loadedModule['default']);

    if (launchFile == null) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const profiles = readPlainObject(launchFile['profiles']);

    if (profiles == null) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    return launchFile as LaunchConfig;
  }
}
