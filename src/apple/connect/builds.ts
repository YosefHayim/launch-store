import type { AscHost } from './host.js';
import type {
  BuildResource,
  BuildUploadStatus,
  EncryptionDeclarationResource,
} from '@/core/types/appleCatalog.js';
import type { ResourceList, BuildPage } from './shared.js';
import type { components } from '@/apple/generated/schema.js';
import { highestAppleMarketingVersion } from '@/apple/transportHelpers.js';
import {
  readTransportSize,
  BUILD_PAGE_QUERY,
  createMarketingVersionFilter,
  buildUploadProblems,
  putAssetFile,
  toBuildResources,
} from './shared.js';

export class ConnectBuilds {
  constructor(private readonly client: AscHost) {}

  async getLatestBuildNumber(bundleId: string): Promise<number> {
    const appId = await this.client.getAppId(bundleId);
    if (!appId) return 0;
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        version: string;
      }>
    >('GET', `/builds?filter[app]=${appId}&sort=-version&limit=1&fields[builds]=version`);
    const latestBuild = appleResources[0];
    if (latestBuild === undefined) return 0;
    const parsedBuildNumber = Number.parseInt(latestBuild.attributes.version, 10);
    if (Number.isNaN(parsedBuildNumber)) return 0;
    return parsedBuildNumber;
  }

  async getLatestMarketingVersion(bundleId: string): Promise<string | null> {
    const appId = await this.client.getAppId(bundleId);
    if (!appId) return null;
    const [appStore, preRelease] = await Promise.all([
      this.client.requestAll<{
        versionString: string;
      }>(`/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`),
      this.client.requestAll<{
        version: string;
      }>(`/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`),
    ]);
    return highestAppleMarketingVersion([
      ...appStore.map((entry) => entry.attributes.versionString),
      ...preRelease.map((entry) => entry.attributes.version),
    ]);
  }

  async getBuildProcessingState(bundleId: string, buildNumber: number): Promise<string | null> {
    const appId = await this.client.getAppId(bundleId);
    if (!appId) return null;
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        processingState: string;
      }>
    >(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=processingState`,
    );
    const matchingBuild = appleResources[0];
    if (matchingBuild === undefined) return null;
    return matchingBuild.attributes.processingState;
  }

  async createBuildUpload(
    appId: string,
    version: string,
    buildNumber: number,
    platform: components['schemas']['Platform'],
  ): Promise<string> {
    const requestDocument: components['schemas']['BuildUploadCreateRequest'] = {
      data: {
        type: 'buildUploads',
        attributes: {
          cfBundleShortVersionString: version,
          cfBundleVersion: String(buildNumber),
          platform,
        },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    };
    const { data: buildUpload } = await this.client.request<
      components['schemas']['BuildUploadResponse']
    >('POST', '/buildUploads', requestDocument);
    return buildUpload.id;
  }

  async uploadBuildFile(
    buildUploadId: string,
    fileName: string,
    binaryPath: string,
  ): Promise<void> {
    const fileByteLength = await readTransportSize(binaryPath);
    let uti = 'com.apple.ipa';
    if (binaryPath.endsWith('.pkg')) uti = 'com.apple.pkg';
    const { id, operations } = await this.client.reserveAsset(
      'buildUploadFiles',
      { relationship: 'buildUpload', type: 'buildUploads', id: buildUploadId },
      fileName,
      fileByteLength,
      { assetType: 'ASSET', uti },
    );
    await putAssetFile(operations, binaryPath, fileByteLength);
    const commitDocument: components['schemas']['BuildUploadFileUpdateRequest'] = {
      data: { type: 'buildUploadFiles', id, attributes: { uploaded: true } },
    };
    await this.client.request<unknown>('PATCH', `/buildUploadFiles/${id}`, commitDocument);
  }

  async getBuildUploadStatus(buildUploadId: string): Promise<BuildUploadStatus> {
    const { data: buildUpload, included } = await this.client.request<
      components['schemas']['BuildUploadResponse']
    >(
      'GET',
      `/buildUploads/${buildUploadId}?include=assetFile&fields[buildUploads]=state,assetFile&fields[buildUploadFiles]=assetDeliveryState`,
    );
    let uploadState = buildUpload.attributes?.state;
    if (uploadState === undefined) uploadState = {};
    const assetFile = included?.find(
      (includedResource) => includedResource.type === 'buildUploadFiles',
    );
    let deliveryState: components['schemas']['AppMediaAssetState'] = {};
    if (
      assetFile?.type === 'buildUploadFiles' &&
      assetFile.attributes?.assetDeliveryState !== undefined
    ) {
      deliveryState = assetFile.attributes.assetDeliveryState;
    }
    let state: string | undefined = uploadState.state;
    if (state === undefined) state = 'AWAITING_UPLOAD';
    let fileState: string | undefined = deliveryState.state;
    if (fileState === undefined) fileState = '';
    return {
      state,
      fileState,
      errors: [
        ...buildUploadProblems(uploadState.errors),
        ...buildUploadProblems(deliveryState.errors),
      ],
    };
  }

  async findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null> {
    const appId = await this.client.getAppId(bundleId);
    if (!appId) return null;
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        usesNonExemptEncryption: boolean | null;
      }>
    >(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=usesNonExemptEncryption`,
    );
    const matchingBuild = appleResources[0];
    if (matchingBuild === undefined) return null;
    let usesNonExemptEncryption = matchingBuild.attributes.usesNonExemptEncryption;
    if (usesNonExemptEncryption === undefined) usesNonExemptEncryption = null;
    return { id: matchingBuild.id, usesNonExemptEncryption };
  }

  async setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void> {
    await this.client.updateResource(`/builds/${buildId}`, {
      type: 'builds',
      id: buildId,
      attributes: { usesNonExemptEncryption: fieldValue },
    });
  }

  async listEncryptionDeclarations(bundleId: string): Promise<EncryptionDeclarationResource[]> {
    const appId = await this.client.getAppId(bundleId);
    if (!appId) return [];
    const appleResources = await this.client.requestAll<{
      appEncryptionDeclarationState: string;
    }>(
      `/apps/${appId}/appEncryptionDeclarations?fields[appEncryptionDeclarations]=appEncryptionDeclarationState&limit=200`,
    );
    return appleResources.map((entry) => ({
      id: entry.id,
      state: entry.attributes.appEncryptionDeclarationState,
    }));
  }

  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    await this.client.request<unknown>(
      'POST',
      `/appEncryptionDeclarations/${declarationId}/relationships/builds`,
      {
        data: [{ type: 'builds', id: buildId }],
      },
    );
  }

  async listBuilds(appId: string, limit = 25): Promise<BuildResource[]> {
    const buildPage = await this.client.request<BuildPage>(
      'GET',
      `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&${BUILD_PAGE_QUERY}`,
    );
    return toBuildResources(buildPage);
  }

  async findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
  ): Promise<BuildResource | null> {
    const versionFilter = createMarketingVersionFilter(marketingVersion);
    const buildPage = await this.client.request<BuildPage>(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}${versionFilter}&sort=-uploadedDate&limit=1&${BUILD_PAGE_QUERY}`,
    );
    const [firstBuild] = toBuildResources(buildPage);
    if (firstBuild === undefined) return null;
    return firstBuild;
  }
}
