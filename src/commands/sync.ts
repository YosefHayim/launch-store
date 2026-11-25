// Makes the live store match the name and version in launch.config.ts.

import { AppStoreConnect } from '@/apple/app-store-connect.js';
import { firstLaunchApp, type LaunchApp } from '@/config/launch-file.js';
import { loadLaunchFile } from '@/config/load-launch-file.js';
import { Keychain } from '@/credentials/keychain.js';
import { GooglePlay } from '@/google/google-play.js';
import {
  describeChanges,
  planStore,
  type StoreChange,
  type StoreSnapshot,
} from '@/plan/plan-store.js';
import { createUsageError } from '@/cli.js';

export async function runSync(argv: string[]): Promise<void> {
  const hasExtraWords = argv.length !== 0;

  if (hasExtraWords) {
    throw createUsageError('launch sync');
  }

  const launchFile = await loadLaunchFile();
  const app = firstLaunchApp(launchFile);
  const keychain = new Keychain();
  await syncIos(app, keychain);
  await syncAndroid(app, keychain);
}

async function syncIos(app: LaunchApp, keychain: Keychain): Promise<void> {
  const ios = app.ios;
  const isIosMissing = ios == null;

  if (isIosMissing) {
    return;
  }

  const apple = new AppStoreConnect(await keychain.readApple());
  const live = await apple.readLive(ios.bundleId);
  const desired: StoreSnapshot = { name: app.name, version: ios.version };
  const changes = planStore(desired, live);
  printChanges('ios', changes);
  const isUnchanged = changes.length === 0;

  if (isUnchanged) {
    return;
  }

  await apple.writeLive(ios.bundleId, desired);
}

async function syncAndroid(app: LaunchApp, keychain: Keychain): Promise<void> {
  const android = app.android;
  const isAndroidMissing = android == null;

  if (isAndroidMissing) {
    return;
  }

  const google = new GooglePlay(await keychain.readGoogle(android.packageName));
  const live = await google.readLive(android.packageName, android.track);
  const desired: StoreSnapshot = { name: app.name, version: android.version };
  const changes = planStore(desired, live);
  printChanges('android', changes);
  const isUnchanged = changes.length === 0;

  if (isUnchanged) {
    return;
  }

  await google.writeLive(android.packageName, android.track, desired);
}

function printChanges(storeName: string, changes: readonly StoreChange[]): void {
  const lines = describeChanges(storeName, changes);

  for (const line of lines) {
    console.log(line);
  }
}
