import type { AscHost } from './host.ts';
import type {
  PreviewResource,
  PreviewSetResource,
  ReviewScreenshotResource,
  ScreenshotResource,
  ScreenshotSetResource,
} from '../../types/appleCatalog.ts';
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
    return appleResources.map((screenshotSet) => {
      let screenshotDisplayType = screenshotSet.attributes.screenshotDisplayType;
      if (screenshotDisplayType === undefined) screenshotDisplayType = '';
      return { id: screenshotSet.id, screenshotDisplayType };
    });
  }

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
    if (screenshotDisplayType === undefined) screenshotDisplayType = displayType;
    return { id: appleResources.id, screenshotDisplayType };
  }

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
    return appleResources.map((screenshot) => {
      let fileName = screenshot.attributes.fileName;
      if (fileName === undefined) fileName = '';
      const screenshotResource: ScreenshotResource = { id: screenshot.id, fileName };
      if (screenshot.attributes.sourceFileChecksum !== undefined)
        Object.assign(screenshotResource, {
          sourceFileChecksum: screenshot.attributes.sourceFileChecksum,
        });
      if (screenshot.attributes.assetDeliveryState?.state !== undefined)
        Object.assign(screenshotResource, {
          assetDeliveryState: screenshot.attributes.assetDeliveryState.state,
        });
      return screenshotResource;
    });
  }

  async deleteScreenshot(screenshotId: string): Promise<void> {
    await this.client.getOptional(() =>
      this.client.deleteResource(`/appScreenshots/${screenshotId}`),
    );
  }

  async reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void> {
    await this.client.request<unknown>(
      'PATCH',
      `/appScreenshotSets/${setId}/relationships/appScreenshots`,
      {
        data: screenshotIds.map((screenshotId) => ({ type: 'appScreenshots', id: screenshotId })),
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
    if (appleResources.attributes.sourceFileChecksum !== undefined)
      Object.assign(reviewScreenshot, {
        sourceFileChecksum: appleResources.attributes.sourceFileChecksum,
      });
    if (appleResources.attributes.assetDeliveryState?.state !== undefined)
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

  async listPreviewSets(versionLocalizationId: string): Promise<PreviewSetResource[]> {
    const appleResources = await this.client.requestAll<{
      previewType?: string;
    }>(
      `/appStoreVersionLocalizations/${versionLocalizationId}/appPreviewSets?fields[appPreviewSets]=previewType&limit=200`,
    );
    return appleResources.map((previewSet) => {
      let previewType = previewSet.attributes.previewType;
      if (previewType === undefined) previewType = '';
      return { id: previewSet.id, previewType };
    });
  }

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
    if (createdPreviewType === undefined) createdPreviewType = previewType;
    return { id: appleResources.id, previewType: createdPreviewType };
  }

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
    return appleResources.map((preview) => {
      let fileName = preview.attributes.fileName;
      if (fileName === undefined) fileName = '';
      const previewResource: PreviewResource = { id: preview.id, fileName };
      if (preview.attributes.sourceFileChecksum !== undefined)
        Object.assign(previewResource, {
          sourceFileChecksum: preview.attributes.sourceFileChecksum,
        });
      if (preview.attributes.assetDeliveryState?.state !== undefined)
        Object.assign(previewResource, {
          assetDeliveryState: preview.attributes.assetDeliveryState.state,
        });
      return previewResource;
    });
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
