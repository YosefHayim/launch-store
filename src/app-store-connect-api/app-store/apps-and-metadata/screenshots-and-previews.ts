// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-metadata
import type {
  PreviewResource,
  PreviewSetResource,
  ScreenshotResource,
  ScreenshotSetResource,
} from '@core/types/appleCatalog.js';
import {
  readTransportFile,
  putAssetFile,
  type AppStoreConnectRequests,
} from '@/app-store-connect-api/api-client.js';

export const makeScreenshotsAndPreviewsApi = (api: AppStoreConnectRequests) => {
  /** List the screenshot sets of any set owner (version or treatment localization). */
  const listScreenshotSetsOf = async (
    ownerType: string,
    ownerId: string,
  ): Promise<ScreenshotSetResource[]> => {
    const appleResources = await api.requestAll<{
      screenshotDisplayType?: string;
    }>(
      `/${ownerType}/${ownerId}/appScreenshotSets?fields[appScreenshotSets]=screenshotDisplayType&limit=200`,
    );
    return appleResources.map((screenshotSet) => {
      let screenshotDisplayType = screenshotSet.attributes.screenshotDisplayType;
      if (screenshotDisplayType === undefined) screenshotDisplayType = '';
      return { id: screenshotSet.id, screenshotDisplayType };
    });
  };

  /** App Store screenshots and subscription review screenshots. */
  /** List the screenshot sets (one per device display type) bound to one App Store version localization. */
  const listScreenshotSets = async (
    versionLocalizationId: string,
  ): Promise<ScreenshotSetResource[]> => {
    return listScreenshotSetsOf('appStoreVersionLocalizations', versionLocalizationId);
  };

  /** Create a screenshot set for one display type under any set owner. */
  const createScreenshotSetOf = async (
    ownerRelationship: string,
    ownerType: string,
    ownerId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> => {
    const appleResources = await api.createResource<{
      screenshotDisplayType?: string;
    }>('/appScreenshotSets', {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: { [ownerRelationship]: { data: { type: ownerType, id: ownerId } } },
    });
    let screenshotDisplayType = appleResources.attributes.screenshotDisplayType;
    if (screenshotDisplayType === undefined) screenshotDisplayType = displayType;
    return { id: appleResources.id, screenshotDisplayType };
  };

  /** Create a screenshot set for one display type under a version localization, returning the new set. */
  const createScreenshotSet = async (
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> => {
    return createScreenshotSetOf(
      'appStoreVersionLocalization',
      'appStoreVersionLocalizations',
      versionLocalizationId,
      displayType,
    );
  };

  /** List the screenshots already in a set, with their stored checksums (the reconciler's skip key). */
  const listScreenshots = async (setId: string): Promise<ScreenshotResource[]> => {
    const appleResources = await api.requestAll<{
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
  };

  /** Delete one screenshot from its set; one Apple no longer has is already gone. */
  const deleteScreenshot = async (screenshotId: string): Promise<void> => {
    await api.getOptional(() => api.deleteResource(`/appScreenshots/${screenshotId}`));
  };

  /** Replace a set's screenshot order with `screenshotIds`, which must list every screenshot in the set. */
  const reorderScreenshots = async (
    setId: string,
    screenshotIds: readonly string[],
  ): Promise<void> => {
    await api.request<unknown>(
      'PATCH',
      `/appScreenshotSets/${setId}/relationships/appScreenshots`,
      {
        data: screenshotIds.map((screenshotId) => ({ type: 'appScreenshots', id: screenshotId })),
      },
    );
  };

  /** Upload one screenshot into a set via the full reserve->PUT->commit asset flow; returns its id. */
  const uploadScreenshot = async (
    setId: string,
    fileName: string,
    filePath: string,
  ): Promise<string> => {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await api.reserveAsset(
      'appScreenshots',
      { relationship: 'appScreenshotSet', type: 'appScreenshotSets', id: setId },
      fileName,
      bytes.byteLength,
    );
    await putAssetFile(operations, filePath, bytes.byteLength);
    await api.commitAsset('appScreenshots', id, bytes);
    return id;
  };

  /** App Store preview videos. */
  /** List the app-preview-video sets (one per device target) bound to one App Store version localization. */
  const listPreviewSets = async (versionLocalizationId: string): Promise<PreviewSetResource[]> => {
    const appleResources = await api.requestAll<{
      previewType?: string;
    }>(
      `/appStoreVersionLocalizations/${versionLocalizationId}/appPreviewSets?fields[appPreviewSets]=previewType&limit=200`,
    );
    return appleResources.map((previewSet) => {
      let previewType = previewSet.attributes.previewType;
      if (previewType === undefined) previewType = '';
      return { id: previewSet.id, previewType };
    });
  };

  /** Create an app-preview-video set for one device target under a version localization, returning the new set. */
  const createPreviewSet = async (
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> => {
    const appleResources = await api.createResource<{
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
  };

  /** List the previews already in a set, with their stored checksums (the reconciler's skip key). */
  const listPreviews = async (setId: string): Promise<PreviewResource[]> => {
    const appleResources = await api.requestAll<{
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
  };

  /**
   * Upload one app preview video into a set via the full reserve->PUT->commit asset flow (identical to
   * {@link uploadScreenshot}; only the resource type differs). The poster frame (`previewFrameTimeCode`) is
   * left to Apple's default selection - the folder convention carries no frame time, and forcing one would
   * invent config nobody asked for; an explicit poster is a deliberate follow-up if ever needed.
   */
  const uploadPreview = async (
    setId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> => {
    const bytes = await readTransportFile(filePath);
    const { id, operations } = await api.reserveAsset(
      'appPreviews',
      { relationship: 'appPreviewSet', type: 'appPreviewSets', id: setId },
      fileName,
      bytes.byteLength,
    );
    await putAssetFile(operations, filePath, bytes.byteLength);
    await api.commitAsset('appPreviews', id, bytes);
  };

  return {
    listScreenshotSets,
    createScreenshotSet,
    listScreenshots,
    deleteScreenshot,
    reorderScreenshots,
    uploadScreenshot,
    listPreviewSets,
    createPreviewSet,
    listPreviews,
    uploadPreview,
  };
};
