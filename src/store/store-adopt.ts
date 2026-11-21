import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@/path-exists.js';
import { AppStoreConnect } from '@/apple/app-store-connect.js';
import { createLaunchFileScaffold } from '@/define-launch-file.js';
import { GooglePlay } from '@/google-play.js';
import { Prompts } from '@/prompts.js';
import { ApplePrivacy } from '@/store/apple/privacy.js';
import { AppleProducts } from '@/store/apple/products.js';
import { AppleVersion } from '@/store/apple/version.js';
import { PlayListing } from '@/store/google/listing.js';
import { PlayTracks } from '@/store/google/tracks.js';

export interface AdoptRequest {
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

    await writeFile(launchFilePath, createLaunchFileScaffold());
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

      const versions = new AppleVersion(this.apple);
      const products = new AppleProducts(this.apple);
      const privacy = new ApplePrivacy(this.apple);
      const versionNames = await versions.list(appId);
      const productIds = await products.list(appId);
      const appInfo = await privacy.list(appId);

      console.log(JSON.stringify({ versionNames, productIds, appInfo }));
    }

    const packageName = adoptRequest.packageName;
    const hasPackage = packageName != null;

    if (hasPackage == false) {
      return;
    }

    const listing = new PlayListing(this.play);
    const tracks = new PlayTracks(this.play);
    const languages = await listing.list(packageName);
    const trackNames = await tracks.list(packageName);

    console.log(JSON.stringify({ languages, trackNames }));
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
