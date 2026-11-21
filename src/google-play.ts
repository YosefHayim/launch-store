import { createReadStream } from 'node:fs';
import { androidpublisher, auth as googleAuth } from '@googleapis/androidpublisher';
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import { AndroidKeystore } from '@/credentials/android-keystore.js';
import { Keychain } from '@/credentials/keychain.js';

export class GooglePlay {
  private readonly publishers = new Map<string, androidpublisher_v3.Androidpublisher>();
  private readonly keystore: AndroidKeystore;

  constructor(private readonly keychain = new Keychain()) {
    this.keystore = new AndroidKeystore(this.keychain);
  }

  async connect(packageName: string): Promise<androidpublisher_v3.Androidpublisher> {
    const saved = this.publishers.get(packageName);
    const isConnected = saved != null;

    if (isConnected) {
      return saved;
    }

    const serviceAccountText = await this.keystore.read(packageName);

    try {
      var serviceAccount = JSON.parse(serviceAccountText);
    } catch (error) {
      throw new Error(`The Play service account for ${packageName} is not JSON`, { cause: error });
    }

    const playAuth = new googleAuth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const publisher = androidpublisher({ version: 'v3', auth: playAuth });

    this.publishers.set(packageName, publisher);

    return publisher;
  }

  /**
   * Opens an edit. Commit it to publish, or delete it to leave the store unchanged.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits/insert
   */
  async openEdit(packageName: string): Promise<string> {
    const publisher = await this.connect(packageName);

    try {
      var opened = await publisher.edits.insert({ packageName });
    } catch (error) {
      throw new Error(`Play did not open an edit for ${packageName}`, { cause: error });
    }

    const editId = opened.data.id;
    const isMissing = editId == null;

    if (isMissing) {
      throw new Error(`Play did not return an edit id for ${packageName}`);
    }

    return editId;
  }

  /**
   * Drops an edit so a read does not stay open on the account.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits/delete
   */
  async deleteEdit(packageName: string, editId: string): Promise<void> {
    const publisher = await this.connect(packageName);

    try {
      await publisher.edits.delete({ packageName, editId });
    } catch (error) {
      throw new Error(`Play did not delete the edit for ${packageName}`, { cause: error });
    }
  }

  /**
   * Publishes the open edit.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit
   */
  async commitEdit(packageName: string, editId: string): Promise<void> {
    const publisher = await this.connect(packageName);

    try {
      await publisher.edits.commit({ packageName, editId });
    } catch (error) {
      throw new Error(`Play did not commit the edit for ${packageName}`, { cause: error });
    }
  }

  /**
   * Uploads an Android App Bundle to an open edit.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload
   */
  async uploadBundle(
    bundleUpload: androidpublisher_v3.Params$Resource$Edits$Bundles$Upload,
  ): Promise<androidpublisher_v3.Schema$Bundle> {
    const packageName = bundleUpload.packageName;
    const isPackageMissing = packageName == null;

    if (isPackageMissing) {
      throw new Error('Play bundle upload needs a package name');
    }

    const publisher = await this.connect(packageName);
    const uploadTimeoutMilliseconds = 120_000;

    try {
      var uploaded = await publisher.edits.bundles.upload(bundleUpload, {
        timeout: uploadTimeoutMilliseconds,
      });
    } catch (error) {
      throw new Error(`Play did not accept the bundle for ${packageName}`, { cause: error });
    }

    return uploaded.data;
  }

  /**
   * Puts one bundle on a track inside an open edit.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update
   */
  async setTrack(
    packageName: string,
    editId: string,
    track: string,
    versionCode: number,
  ): Promise<void> {
    const publisher = await this.connect(packageName);

    try {
      await publisher.edits.tracks.update({
        packageName,
        editId,
        track,
        requestBody: {
          track,
          releases: [{ status: 'completed', versionCodes: [String(versionCode)] }],
        },
      });
    } catch (error) {
      throw new Error(`Play did not update the ${track} track for ${packageName}`, {
        cause: error,
      });
    }
  }

  /**
   * Lists in-app products for one app.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts/list
   */
  async listInAppProducts(packageName: string): Promise<readonly string[]> {
    const publisher = await this.connect(packageName);

    try {
      var listed = await publisher.inappproducts.list({ packageName });
    } catch (error) {
      throw new Error(`Play did not list in-app products for ${packageName}`, { cause: error });
    }

    const products = listed.data.inappproduct;
    const isMissing = products == null;

    if (isMissing) {
      return [];
    }

    const productIds: string[] = [];

    for (const product of products) {
      const productId = product.sku;
      const isBlank = productId == null;

      if (isBlank) {
        continue;
      }

      productIds.push(productId);
    }

    return productIds;
  }

  /**
   * Lists store listing languages inside an open edit.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list
   */
  async listListings(packageName: string, editId: string): Promise<readonly string[]> {
    const publisher = await this.connect(packageName);

    try {
      var listed = await publisher.edits.listings.list({ packageName, editId });
    } catch (error) {
      throw new Error(`Play did not list store listings for ${packageName}`, { cause: error });
    }

    const listings = listed.data.listings;
    const isMissing = listings == null;

    if (isMissing) {
      return [];
    }

    const languages: string[] = [];

    for (const listing of listings) {
      const language = listing.language;
      const isBlank = language == null;

      if (isBlank) {
        continue;
      }

      languages.push(language);
    }

    return languages;
  }

  /**
   * Lists tracks inside an open edit.
   *
   * @see https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/list
   */
  async listTracks(packageName: string, editId: string): Promise<readonly string[]> {
    const publisher = await this.connect(packageName);

    try {
      var listed = await publisher.edits.tracks.list({ packageName, editId });
    } catch (error) {
      throw new Error(`Play did not list tracks for ${packageName}`, { cause: error });
    }

    const tracks = listed.data.tracks;
    const isMissing = tracks == null;

    if (isMissing) {
      return [];
    }

    const trackNames: string[] = [];

    for (const track of tracks) {
      const trackName = track.track;
      const isBlank = trackName == null;

      if (isBlank) {
        continue;
      }

      trackNames.push(trackName);
    }

    return trackNames;
  }

  bundleStream(bundlePath: string): ReturnType<typeof createReadStream> {
    return createReadStream(bundlePath);
  }
}
