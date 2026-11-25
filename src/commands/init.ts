// Writes a starter launch.config.ts in the current directory.

import { access, writeFile } from 'node:fs/promises';

import { printLaunchFile, type LaunchFile } from '@/config/launch-file.js';
import { UsageError } from '@/usage-error.js';

export async function runInit(argv: string[]): Promise<void> {
  const hasExtraWords = argv.length !== 0;

  if (hasExtraWords) {
    throw new UsageError('launch init');
  }

  const launchFilePath = 'launch.config.ts';

  try {
    await access(launchFilePath);
  } catch (error) {
    const isMissing = isMissingFile(error);

    if (isMissing) {
      await writeFile(launchFilePath, printLaunchFile(starterLaunchFile()));
      console.log('[OK] wrote launch.config.ts');

      return;
    }

    throw error;
  }

  throw new Error('launch.config.ts already exists.');
}

function starterLaunchFile(): LaunchFile {
  return {
    apps: [
      {
        name: 'My App',
        projectPath: '.',
        ios: {
          bundleId: 'com.example.app',
          version: '1.0.0',
          buildNumber: 1,
          scheme: 'MyApp',
        },
        android: {
          packageName: 'com.example.app',
          version: '1.0.0',
          track: 'internal',
        },
      },
    ],
  };
}

function isMissingFile(error: unknown): boolean {
  const isError = error instanceof Error;

  if (!isError) {
    return false;
  }

  return Reflect.get(error, 'code') === 'ENOENT';
}
