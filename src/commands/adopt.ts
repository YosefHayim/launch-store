// Copies the live store name and version back into launch.config.ts.

import { writeFile } from 'node:fs/promises';

import { AppStoreConnect } from '@/apple/app-store-connect.js';
import {
  firstLaunchApp,
  printLaunchFile,
  type AndroidApp,
  type IosApp,
  type LaunchApp,
} from '@/config/launch-file.js';
import { loadLaunchFile } from '@/config/load-launch-file.js';
import { Keychain } from '@/credentials/keychain.js';
import { GooglePlay } from '@/google/google-play.js';
import type { StoreSnapshot } from '@/plan/plan-store.js';
import { createUsageError } from '@/cli.js';

export async function runAdopt(argv: string[]): Promise<void> {
  const hasExtraWords = argv.length !== 0;

  if (hasExtraWords) {
    throw createUsageError('launch adopt');
  }

  const launchFile = await loadLaunchFile();
  const app = firstLaunchApp(launchFile);
  const keychain = new Keychain();
  const iosLive = await readIos(app, keychain);
  const androidLive = await readAndroid(app, keychain);
  const adopted = adoptApp(app, iosLive, androidLive);
  await writeFile('launch.config.ts', printLaunchFile({ apps: [adopted] }));
  console.log('[OK] wrote launch.config.ts from the live store');
}

async function readIos(app: LaunchApp, keychain: Keychain): Promise<StoreSnapshot | null> {
  const ios = app.ios;
  const isIosMissing = ios == null;

  if (isIosMissing) {
    return null;
  }

  const apple = new AppStoreConnect(await keychain.readApple());

  return apple.readLive(ios.bundleId);
}

async function readAndroid(app: LaunchApp, keychain: Keychain): Promise<StoreSnapshot | null> {
  const android = app.android;
  const isAndroidMissing = android == null;

  if (isAndroidMissing) {
    return null;
  }

  const google = new GooglePlay(await keychain.readGoogle(android.packageName));

  return google.readLive(android.packageName, android.track);
}

function adoptApp(
  app: LaunchApp,
  iosLive: StoreSnapshot | null,
  androidLive: StoreSnapshot | null,
): LaunchApp {
  return {
    name: adoptedName(app, iosLive, androidLive),
    projectPath: app.projectPath,
    ios: adoptedIos(app.ios, iosLive),
    android: adoptedAndroid(app.android, androidLive),
  };
}

function adoptedName(
  app: LaunchApp,
  iosLive: StoreSnapshot | null,
  androidLive: StoreSnapshot | null,
): string {
  const isIosMissing = iosLive == null;

  if (!isIosMissing) {
    return iosLive.name;
  }

  const isAndroidMissing = androidLive == null;

  if (!isAndroidMissing) {
    return androidLive.name;
  }

  return app.name;
}

function adoptedIos(ios: IosApp | null, live: StoreSnapshot | null): IosApp | null {
  const isMissing = ios == null;

  if (isMissing) {
    return null;
  }

  const isLiveMissing = live == null;

  if (isLiveMissing) {
    return ios;
  }

  if (live.version == null) {
    return ios;
  }

  return { ...ios, version: live.version };
}

function adoptedAndroid(android: AndroidApp | null, live: StoreSnapshot | null): AndroidApp | null {
  const isMissing = android == null;

  if (isMissing) {
    return null;
  }

  const isLiveMissing = live == null;

  if (isLiveMissing) {
    return android;
  }

  if (live.version == null) {
    return android;
  }

  return { ...android, version: live.version };
}
