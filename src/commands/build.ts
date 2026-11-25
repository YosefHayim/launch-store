// launch build ios, or launch build android.

import { BuildPipeline } from '@/build/build-pipeline.js';
import { loadLaunchFile } from '@/config/load-launch-file.js';
import { Keychain } from '@/credentials/keychain.js';
import { createUsageError } from '@/cli.js';

export async function runBuild(argv: string[]): Promise<void> {
  const platform = readPlatform(argv, 'launch build ios   or   launch build android');
  const launchFile = await loadLaunchFile();
  const pipeline = new BuildPipeline(launchFile, new Keychain());
  const uploadedPath = await pipeline.run(platform);
  console.log(`[OK] uploaded ${uploadedPath}`);
}

export function readPlatform(argv: string[], usage: string): 'ios' | 'android' {
  const platform = argv[0];
  const isIos = platform === 'ios';

  if (isIos) {
    return 'ios';
  }

  const isAndroid = platform === 'android';

  if (isAndroid) {
    return 'android';
  }

  throw createUsageError(usage);
}
