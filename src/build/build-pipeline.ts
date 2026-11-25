// Compiles one app, then uploads the ipa or the aab.

import { AppStoreConnect } from '@/apple/app-store-connect.js';
import { compileAndroid } from '@/build/gradle.js';
import { compileIos } from '@/build/xcode.js';
import type { LaunchApp, LaunchFile } from '@/config/launch-file.js';
import type { Keychain } from '@/credentials/keychain.js';
import { GooglePlay } from '@/google/google-play.js';

export class BuildPipeline {
  constructor(
    private launchFile: LaunchFile,
    private keychain: Keychain,
  ) {}

  async run(platform: 'ios' | 'android'): Promise<string> {
    const app = this.launchFile.apps[0];
    const isAppMissing = app == null;

    if (isAppMissing) {
      throw new Error('launch.config.ts needs at least one app.');
    }

    const isIos = platform === 'ios';

    if (isIos) {
      return this.runIos(app);
    }

    return this.runAndroid(app);
  }

  private async runIos(app: LaunchApp): Promise<string> {
    const ios = app.ios;
    const isIosMissing = ios == null;

    if (isIosMissing) {
      throw new Error(`${app.name} has no ios settings in launch.config.ts.`);
    }

    const appleKey = await this.keychain.readApple();
    const apple = new AppStoreConnect(appleKey);
    const ipaPath = await compileIos(app);
    await apple.uploadBuild({
      bundleId: ios.bundleId,
      version: ios.version,
      buildNumber: ios.buildNumber,
      ipaPath,
    });

    return ipaPath;
  }

  private async runAndroid(app: LaunchApp): Promise<string> {
    const android = app.android;
    const isAndroidMissing = android == null;

    if (isAndroidMissing) {
      throw new Error(`${app.name} has no android settings in launch.config.ts.`);
    }

    const serviceAccountJson = await this.keychain.readGoogle(android.packageName);
    const google = new GooglePlay(serviceAccountJson);
    const aabPath = await compileAndroid(app);
    await google.uploadBundle(android.packageName, aabPath, android.track);

    return aabPath;
  }
}
