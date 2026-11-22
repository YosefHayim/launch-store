import { basename } from 'node:path';
import type { LaunchConfig } from '../types/config.ts';

interface LoadedModule {
  default?: unknown;
}

interface AuthoredLaunchFile {
  profiles?: unknown;
}

export class CheckLaunchFile {
  check(importedLaunchFile: unknown, launchFilePath: string): LaunchConfig {
    const fileName = basename(launchFilePath);
    const isMissing = importedLaunchFile == null;

    if (isMissing) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const isObject = typeof importedLaunchFile == 'object';

    if (isObject == false) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const loadedModule = importedLaunchFile as LoadedModule;
    const launchFile = loadedModule.default;
    const isDefaultMissing = launchFile == null;

    if (isDefaultMissing) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const isDefaultObject = typeof launchFile == 'object';

    if (isDefaultObject == false) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const authored = launchFile as AuthoredLaunchFile;
    const hasProfiles = authored.profiles != null;

    if (hasProfiles == false) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    const profilesAreObject = typeof authored.profiles == 'object';

    if (profilesAreObject == false) {
      throw new Error(`${fileName} must \`export default defineConfig({ ... })\`.`);
    }

    return launchFile as LaunchConfig;
  }
}
