import type { AscHost } from './host.ts';
import type {
  BuildResource,
  BuildUploadStatus,
  EncryptionDeclarationResource,
} from '@/types/apple-catalog.js';
import type { ResourceList, BuildPage } from './shared.ts';
import type { components } from '@/apple-api-types.js';
import { highestAppleMarketingVersion } from '../transport-helpers.ts';
import {
  readTransportSize,
  BUILD_PAGE_QUERY,
  createMarketingVersionFilter,
  buildUploadProblems,
  putAssetFile,
  readBuildResources,
} from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectBuilds {
  constructor(private readonly client: AscHost) {}

  /**
   * Find and list builds for all apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
   */
  async getLatestBuildNumber(bundleId: string): Promise<number> {
    const appId = await this.client.getAppId(bundleId);

    if (!appId) return 0;

    const { data: appleResources } = await this.client.request<
      ResourceList<{
        version: string;
      }>
    >('GET', `/builds?filter[app]=${appId}&sort=-version&limit=1&fields[builds]=version`);
    const latestBuild = appleResources[0];

    if (latestBuild == null) return 0;

    const parsedBuildNumber = Number.parseInt(latestBuild.attributes.version, 10);

    if (Number.isNaN(parsedBuildNumber)) return 0;

    return parsedBuildNumber;
  }

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-prereleaseversions
   */
  async getLatestMarketingVersion(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    const appId = await this.client.getAppId(bundleId);

    if (!appId) return null;

    const [appStore, preRelease] = await Promise.all([
      this.client.requestAll<{
        versionString: string;
      }>(
        applyAppleListQuery(
          `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`,
          listQuery,
          APPLE_PAGE_LIMIT,
        ),
      ),
      this.client.requestAll<{
        version: string;
      }>(
        applyAppleListQuery(
          `/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`,
          listQuery,
          APPLE_PAGE_LIMIT,
        ),
      ),
    ]);

    function readVersionString(entry: {
      id: string;
      attributes: { versionString: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return entry.attributes.versionString;
    }

    function readVersion(entry: {
      id: string;
      attributes: { version: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return entry.attributes.version;
    }

    return highestAppleMarketingVersion([
      ...appStore.map(readVersionString),
      ...preRelease.map(readVersion),
    ]);
  }

  /**
   * Find and list builds for all apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
   */
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

    if (matchingBuild == null) return null;

    return matchingBuild.attributes.processingState;
  }

  /**
   * Add a new build upload to an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploads
   */
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

  /**
   * Commit a build upload file to a specific build upload.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builduploadfiles-_id_
   */
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

  /**
   * Get details about a specific build upload file for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploads-_id_
   */
  async getBuildUploadStatus(buildUploadId: string): Promise<BuildUploadStatus> {
    const { data: buildUpload, included } = await this.client.request<
      components['schemas']['BuildUploadResponse']
    >(
      'GET',
      `/buildUploads/${buildUploadId}?include=assetFile&fields[buildUploads]=state,assetFile&fields[buildUploadFiles]=assetDeliveryState`,
    );
    let uploadState = buildUpload.attributes?.state;

    if (uploadState == null) uploadState = {};

    const assetFile = included?.find(
      (includedResource) => includedResource.type == 'buildUploadFiles',
    );
    let deliveryState: components['schemas']['AppMediaAssetState'] = {};

    if (assetFile?.type == 'buildUploadFiles' && assetFile.attributes?.assetDeliveryState != null) {
      deliveryState = assetFile.attributes.assetDeliveryState;
    }

    let state: string | undefined = uploadState.state;

    if (state == null) state = 'AWAITING_UPLOAD';

    let fileState: string | undefined = deliveryState.state;

    if (fileState == null) fileState = '';

    return {
      state,
      fileState,
      errors: [
        ...buildUploadProblems(uploadState.errors),
        ...buildUploadProblems(deliveryState.errors),
      ],
    };
  }

  /**
   * Find and list builds for all apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
   */
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

    if (matchingBuild == null) return null;

    let usesNonExemptEncryption = matchingBuild.attributes.usesNonExemptEncryption;

    if (usesNonExemptEncryption == null) usesNonExemptEncryption = null;

    return { id: matchingBuild.id, usesNonExemptEncryption };
  }

  /**
   * Expire a build or change its encryption exemption setting.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builds-_id_
   */
  async setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void> {
    await this.client.updateResource(`/builds/${buildId}`, {
      type: 'builds',
      id: buildId,
      attributes: { usesNonExemptEncryption: fieldValue },
    });
  }

  /**
   * Find and list all available app encryption declarations.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appencryptiondeclarations
   */
  async listEncryptionDeclarations(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<EncryptionDeclarationResource[]> {
    const appId = await this.client.getAppId(bundleId);

    if (!appId) return [];

    const appleResources = await this.client.requestAll<{
      appEncryptionDeclarationState: string;
    }>(
      applyAppleListQuery(
        `/apps/${appId}/appEncryptionDeclarations?fields[appEncryptionDeclarations]=appEncryptionDeclarationState&limit=200`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyEncryptionDeclaration(entry: {
      id: string;
      attributes: { appEncryptionDeclarationState: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return {
        id: entry.id,
        state: entry.attributes.appEncryptionDeclarationState,
      };
    }

    return appleResources.map(copyEncryptionDeclaration);
  }

  /**
   * Assign one or more builds to an app encryption declaration.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appencryptiondeclarations-_id_-relationships-builds
   */
  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    await this.client.request<unknown>(
      'POST',
      `/appEncryptionDeclarations/${declarationId}/relationships/builds`,
      {
        data: [{ type: 'builds', id: buildId }],
      },
    );
  }

  /**
   * Find and list builds for all apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
   */
  async listBuilds(
    appId: string,
    limit = 25,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildResource[]> {
    const buildPage = await this.client.request<BuildPage>(
      'GET',
      applyAppleListQuery(
        `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&${BUILD_PAGE_QUERY}`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    return readBuildResources(buildPage);
  }

  /**
   * Find and list builds for all apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
   */
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
    const [firstBuild] = readBuildResources(buildPage);

    if (firstBuild == null) return null;

    return firstBuild;
  }
}
