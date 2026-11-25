// Sends an uploaded build to review without compiling again.

import { AppStoreConnect } from '@/apple/app-store-connect.js';
import { firstLaunchApp } from '@/config/launch-file.js';
import { loadLaunchFile } from '@/config/load-launch-file.js';
import { Keychain } from '@/credentials/keychain.js';
import { GooglePlay } from '@/google/google-play.js';

import { readPlatform } from './build.js';

export async function runRelease(argv: string[]): Promise<void> {
  const platform = readPlatform(argv, 'launch release ios   or   launch release android');
  const launchFile = await loadLaunchFile();
  const app = firstLaunchApp(launchFile);
  const keychain = new Keychain();
  const isIos = platform === 'ios';

  if (isIos) {
    const ios = app.ios;
    const isIosMissing = ios == null;

    if (isIosMissing) {
      throw new Error(`${app.name} has no ios settings in launch.config.ts.`);
    }

    const apple = new AppStoreConnect(await keychain.readApple());
    await apple.submit(ios.bundleId);
    console.log('[OK] submitted to App Review');

    return;
  }

  const android = app.android;
  const isAndroidMissing = android == null;

  if (isAndroidMissing) {
    throw new Error(`${app.name} has no android settings in launch.config.ts.`);
  }

  const google = new GooglePlay(await keychain.readGoogle(android.packageName));
  await google.releaseTrack(android.packageName, android.track);
  console.log('[OK] released to production');
}
