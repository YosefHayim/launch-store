// Prints the live store and writes a starter launch.config.ts when adopting an app.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { AppStoreConnect } from '../apple/app-store-connect.ts';
import { createLaunchFileScaffold } from '../define-launch-file.ts';
import { GooglePlay } from '../google-play.ts';
import { Prompts } from '../prompts.ts';
import { ApplePrivacy } from '../apple/privacy.ts';
import { InAppPurchaseIds } from '../apple/in-app-purchase-ids.ts';
import { AppStoreVersions } from '../apple/app-store-versions.ts';
import { PlayListings } from '../google/listings.ts';
import { PlayTracks } from '../google/tracks.ts';

interface AdoptRequest {
  directory: string;
  hasYes: boolean;
  isDryRun: boolean;
  bundleId: string | null;
  packageName: string | null;
}

export class StoreAdopt {
  constructor(
    private readonly apple = new AppStoreConnect(),
    private readonly play = new GooglePlay(),
    private readonly prompts = new Prompts(),
  ) {}

  async run(adoptRequest: AdoptRequest): Promise<void> {
    const isDryRun = adoptRequest.isDryRun;

    if (isDryRun) {
      await this.printLive(adoptRequest);
      return;
    }

    const isAllowed = await this.allow(adoptRequest.hasYes);

    if (isAllowed == false) {
      return;
    }

    await this.printLive(adoptRequest);

    const launchFilePath = join(adoptRequest.directory, 'launch.config.ts');

    const exists = await pathExists(launchFilePath);

    if (exists) {
      console.log('Left launch.config.ts untouched. Live product ids are listed above.');
      return;
    }

    const launchFileScaffold = createLaunchFileScaffold();

    await writeFile(launchFilePath, launchFileScaffold);
    console.log('Wrote launch.config.ts');
  }

  private async printLive(adoptRequest: AdoptRequest): Promise<void> {
    const bundleId = adoptRequest.bundleId;

    const hasBundle = bundleId != null;

    if (hasBundle) {
      const appId = await this.apple.findAppId(bundleId);

      const isMissing = appId == null;

      if (isMissing) {
        throw new Error(`App Store Connect has no app ${bundleId}`);
      }

      const appStoreVersions = new AppStoreVersions(this.apple);
      const inAppPurchaseIds = new InAppPurchaseIds(this.apple);
      const privacy = new ApplePrivacy(this.apple);
      const versionNames = await appStoreVersions.list(appId);
      const productIds = await inAppPurchaseIds.list(appId);
      const appInfo = await privacy.list(appId);

      const serialized = JSON.stringify({ versionNames, productIds, appInfo });

      console.log(serialized);
    }

    const packageName = adoptRequest.packageName;
    const hasPackage = packageName != null;

    if (hasPackage == false) {
      return;
    }

    const listings = new PlayListings(this.play);
    const tracks = new PlayTracks(this.play);
    const languages = await listings.list(packageName);
    const trackNames = await tracks.list(packageName);

    const serialized = JSON.stringify({ languages, trackNames });

    console.log(serialized);
  }

  private async allow(hasYes: boolean): Promise<boolean> {
    if (hasYes) {
      return true;
    }

    const isInteractive = this.prompts.isInteractive();

    if (isInteractive == false) {
      throw new Error('Pass --yes to adopt without a terminal');
    }

    return this.prompts.confirm('Write the live store into launch.config.ts?');
  }
}
