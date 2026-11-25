// Prints what launch sync would change. It does not write to the store.

import { AppStoreConnect } from '@/apple/app-store-connect.js';
import { firstLaunchApp, type LaunchApp } from '@/config/launch-file.js';
import { loadLaunchFile } from '@/config/load-launch-file.js';
import { Keychain } from '@/credentials/keychain.js';
import { GooglePlay } from '@/google/google-play.js';
import { describeChanges, planStore, type StoreSnapshot } from '@/plan/plan-store.js';
import { UsageError } from '@/usage-error.js';

export async function runPlan(argv: string[]): Promise<void> {
  const hasExtraWords = argv.length !== 0;

  if (hasExtraWords) {
    throw new UsageError('launch plan');
  }

  const launchFile = await loadLaunchFile();
  const app = firstLaunchApp(launchFile);
  const keychain = new Keychain();
  const lines = await planLines(app, keychain);

  for (const line of lines) {
    console.log(line);
  }
}

async function planLines(app: LaunchApp, keychain: Keychain): Promise<string[]> {
  const lines: string[] = [];
  const ios = app.ios;
  const isIosMissing = ios == null;

  if (!isIosMissing) {
    const apple = new AppStoreConnect(await keychain.readApple());
    const live = await apple.readLive(ios.bundleId);
    const desired: StoreSnapshot = { name: app.name, version: ios.version };
    lines.push(...describeChanges('ios', planStore(desired, live)));
  }

  const android = app.android;
  const isAndroidMissing = android == null;

  if (!isAndroidMissing) {
    const google = new GooglePlay(await keychain.readGoogle(android.packageName));
    const live = await google.readLive(android.packageName, android.track);
    const desired: StoreSnapshot = { name: app.name, version: android.version };
    lines.push(...describeChanges('android', planStore(desired, live)));
  }

  return lines;
}
