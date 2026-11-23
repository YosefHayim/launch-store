import type { AscHost } from './host.ts';
import type {
  PreviewResource,
  PreviewSetResource,
  ReviewScreenshotResource,
  ScreenshotResource,
  ScreenshotSetResource,
} from '@/types/apple-catalog.js';
import { readTransportFile, putAssetFile } from './shared.ts';

export class ConnectScreenshots {
  constructor(private readonly client: AscHost) {}

  async listScreenshotSets(versionLocalizationId: string): Promise<ScreenshotSetResource[]> {
    return this.listScreenshotSetsOf('appStoreVersionLocalizations', versionLocalizationId);
  }

  async createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.createScreenshotSetOf(
      'appStoreVersionLocalization',
      'appStoreVersionLocalizations',
      versionLocalizationId,
      displayType,
    );
  }

  async listTreatmentScreenshotSets(
    treatmentLocalizationId: string,
  ): Promise<ScreenshotSetResource[]> {
    return this.listScreenshotSetsOf(
      'appStoreVersionExperimentTreatmentLocalizations',
      treatmentLocalizationId,
    );
  }

  async createTreatmentScreenshotSet(
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.createScreenshotSetOf(
      'appStoreVersionExperimentTreatmentLocalization',
      'appStoreVersionExperimentTreatmentLocalizations',
      treatmentLocalizationId,
      displayType,
    );
  }

  private async listScreenshotSetsOf(
    ownerType: string,
    ownerId: string,
  ): Promise<ScreenshotSetResource[]> {
    const appleResources = await this.client.requestAll<{
      screenshotDisplayType?: string;
    }>(
      `/${ownerType}/${ownerId}/appScreenshotSets?fields[appScreenshotSets]=screenshotDisplayType&limit=200`,
    );

    function mapScreenshotSet(screenshotSet: {
      id: string;
      attributes: { screenshotDisplayType?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let screenshotDisplayType = screenshotSet.attributes.screenshotDisplayType;

      if (screenshotDisplayType == null) screenshotDisplayType = '';

      return { id: screenshotSet.id, screenshotDisplayType };
    }

    return appleResources.map(mapScreenshotSet);
  }

  /**
   * Add a new screenshot set to an App Store version localization for a specific screenshot type
   * and display size.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshotsets
   */
  private async createScreenshotSetOf(
    ownerRelationship: string,
    ownerType: string,
    ownerId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    const appleResources = await this.client.createResource<{
      screenshotDisplayType?: string;
    }>('/appScreenshotSets', {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: { [ownerRelationship]: { data: { type: ownerType, id: ownerId } } },
    });
    let screenshotDisplayType = appleResources.attributes.screenshotDisplayType;

    if (screenshotDisplayType == null) screenshotDisplayType = displayType;

    return { id: appleResources.id, screenshotDisplayType };
  }

  /**
   * List all ordered screenshots in a screenshot set.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_-appscreenshots
   */
  async listScreenshots(setId: string): Promise<ScreenshotResource[]> {
    const appleResources = await this.client.requestAll<{
      fileName?: string;
      sourceFileChecksum?: string;
      assetDeliveryState?: {
        state?: string;
      };
    }>(
      `/appScreenshotSets/${setId}/appScreenshots?fields[appScreenshots]=fileName,sourceFileChecksum,assetDeliveryState&limit=200`,
    );

    function mapScreenshot(screenshot: {
      id: string;
      attributes: {
        fileName?: string;
        sourceFileChecksum?: string;
        assetDeliveryState?: { state?: string };
      };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let fileName = screenshot.attributes.fileName;

      if (fileName == null) fileName = '';

      const screenshotResource: ScreenshotResource = { id: screenshot.id, fileName };

      if (screenshot.attributes.sourceFileChecksum != null)
        Object.assign(screenshotResource, {
          sourceFileChecksum: screenshot.attributes.sourceFileChecksum,
        });

      if (screenshot.attributes.assetDeliveryState?.state != null)
        Object.assign(screenshotResource, {
          assetDeliveryState: screenshot.attributes.assetDeliveryState.state,
        });

      return screenshotResource;
    }

    return appleResources.map(mapScreenshot);
  }

  /**
   * Delete an app screenshot that is associated with a screenshot set.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appscreenshots-_id_
   */
  async deleteScreenshot(screenshotId: string): Promise<void> {
    await this.client.getOptional(() =>
      this.client.deleteResource(`/appScreenshots/${screenshotId}`),
    );
  }

  /**
   * Change the order of the screenshots in a screenshot set.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appscreenshotsets-_id_-relationships-appscreenshots
   */
  async reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void> {
    function mapScreenshotId(screenshotId: string) {
      return { type: 'appScreenshots', id: screenshotId };
    }

    await this.client.request<unknown>(
      'PATCH',
      `/appScreenshotSets/${setId}/relationships/appScreenshots`,
      {
        data: screenshotIds.map(mapScreenshotId),
      },
    );
  }

  async uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<string> {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await this.client.reserveAsset(
      'appScreenshots',
      { relationship: 'appScreenshotSet', type: 'appScreenshotSets', id: setId },
      fileName,
      bytes.byteLength,
    );

    await putAssetFile(operations, filePath, bytes.byteLength);
    await this.client.commitAsset('appScreenshots', id, bytes);

    return id;
  }

  /**
   * Get information about review screenshot for a specific auto-renewable subscription.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-appstorereviewscreenshot
   */
  async getSubscriptionReviewScreenshot(
    subscriptionId: string,
  ): Promise<ReviewScreenshotResource | null> {
    const { data: appleResources } = await this.client.request<{
      data: {
        id: string;
        attributes: {
          sourceFileChecksum?: string;
          assetDeliveryState?: {
            state?: string;
          };
        };
      } | null;
    }>(
      'GET',
      `/subscriptions/${subscriptionId}/appStoreReviewScreenshot?fields[subscriptionAppStoreReviewScreenshots]=sourceFileChecksum,assetDeliveryState`,
    );

    if (!appleResources) return null;

    const reviewScreenshot: ReviewScreenshotResource = { id: appleResources.id };

    if (appleResources.attributes.sourceFileChecksum != null)
      Object.assign(reviewScreenshot, {
        sourceFileChecksum: appleResources.attributes.sourceFileChecksum,
      });

    if (appleResources.attributes.assetDeliveryState?.state != null)
      Object.assign(reviewScreenshot, {
        assetDeliveryState: appleResources.attributes.assetDeliveryState.state,
      });

    return reviewScreenshot;
  }

  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await this.client.reserveAsset(
      'subscriptionAppStoreReviewScreenshots',
      { relationship: 'subscription', type: 'subscriptions', id: subscriptionId },
      fileName,
      bytes.byteLength,
    );

    await putAssetFile(operations, filePath, bytes.byteLength);
    await this.client.commitAsset('subscriptionAppStoreReviewScreenshots', id, bytes);
  }

  /**
   * List all app preview sets for a specific localization.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-apppreviewsets
   */
  async listPreviewSets(versionLocalizationId: string): Promise<PreviewSetResource[]> {
    const appleResources = await this.client.requestAll<{
      previewType?: string;
    }>(
      `/appStoreVersionLocalizations/${versionLocalizationId}/appPreviewSets?fields[appPreviewSets]=previewType&limit=200`,
    );

    function mapPreviewSet(previewSet: {
      id: string;
      attributes: { previewType?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let previewType = previewSet.attributes.previewType;

      if (previewType == null) previewType = '';

      return { id: previewSet.id, previewType };
    }

    return appleResources.map(mapPreviewSet);
  }

  /**
   * Add a new app preview set to an App Store version localization for a specific app preview type
   * and display size.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppreviewsets
   */
  async createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> {
    const appleResources = await this.client.createResource<{
      previewType?: string;
    }>('/appPreviewSets', {
      type: 'appPreviewSets',
      attributes: { previewType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: versionLocalizationId },
        },
      },
    });
    let createdPreviewType = appleResources.attributes.previewType;

    if (createdPreviewType == null) createdPreviewType = previewType;

    return { id: appleResources.id, previewType: createdPreviewType };
  }

  /**
   * List all ordered app previews in a preview set.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviewsets-_id_-apppreviews
   */
  async listPreviews(setId: string): Promise<PreviewResource[]> {
    const appleResources = await this.client.requestAll<{
      fileName?: string;
      sourceFileChecksum?: string;
      assetDeliveryState?: {
        state?: string;
      };
    }>(
      `/appPreviewSets/${setId}/appPreviews?fields[appPreviews]=fileName,sourceFileChecksum,assetDeliveryState&limit=200`,
    );

    function mapPreview(preview: {
      id: string;
      attributes: {
        fileName?: string;
        sourceFileChecksum?: string;
        assetDeliveryState?: { state?: string };
      };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let fileName = preview.attributes.fileName;

      if (fileName == null) fileName = '';

      const previewResource: PreviewResource = { id: preview.id, fileName };

      if (preview.attributes.sourceFileChecksum != null)
        Object.assign(previewResource, {
          sourceFileChecksum: preview.attributes.sourceFileChecksum,
        });

      if (preview.attributes.assetDeliveryState?.state != null)
        Object.assign(previewResource, {
          assetDeliveryState: preview.attributes.assetDeliveryState.state,
        });

      return previewResource;
    }

    return appleResources.map(mapPreview);
  }

  async uploadPreview(setId: string, fileName: string, filePath: string): Promise<void> {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await this.client.reserveAsset(
      'appPreviews',
      { relationship: 'appPreviewSet', type: 'appPreviewSets', id: setId },
      fileName,
      bytes.byteLength,
    );

    await putAssetFile(operations, filePath, bytes.byteLength);
    await this.client.commitAsset('appPreviews', id, bytes);
  }
}
