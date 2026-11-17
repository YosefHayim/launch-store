import type {
  BuildResource,
  BuildUploadProblem,
  BuildUploadStatus,
  EncryptionDeclarationResource,
} from '@core/types/appleCatalog.js';
import type { components } from '@apple/generated/schema.js';
import {
  highestAppleMarketingVersion,
  putAssetFile,
  readTransportSize,
} from '@/app-store-connect-api/api-client.js';
import type { AppStoreConnectRequests, ResourceList } from '@/app-store-connect-api/api-client.js';
import type { AppsApi } from '@/app-store-connect-api/app-store/apps-and-metadata/apps.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/builds
/** Flatten Apple's optional state details into the code + description pairs a submitter reports. */
const buildUploadProblems = (
  stateDetails: readonly components['schemas']['StateDetail'][] | undefined,
): BuildUploadProblem[] => {
  if (stateDetails === undefined) return [];
  return stateDetails.map((stateDetail) => {
    let code = stateDetail.code;
    if (code === undefined) code = '';
    let description = stateDetail.description;
    if (description === undefined) description = '';
    return { code, description };
  });
};
const BUILD_PAGE_QUERY =
  'fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion&include=preReleaseVersion&fields[preReleaseVersions]=version';
const createMarketingVersionFilter = (marketingVersion: string | undefined): string => {
  const isMarketingVersionGiven = marketingVersion !== undefined;
  if (!isMarketingVersionGiven) return '';
  return `&filter[preReleaseVersion.version]=${marketingVersion}`;
};
type BuildPageIncluded = {
  type: string;
  id: string;
  attributes?: {
    version?: string;
    processingState?: string;
  };
};
type BuildPage = {
  data: {
    id: string;
    attributes: {
      version?: string;
      processingState?: string;
      uploadedDate?: string;
      expired?: boolean;
    };
    relationships?: {
      preReleaseVersion?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  included?: BuildPageIncluded[];
};
/** Map a raw build row onto a BuildResource, defaulting the optional/absent attributes. */
const toBuildResource = (
  entry: BuildPage['data'][number],
  preReleaseVersions: readonly BuildPageIncluded[],
): BuildResource => {
  let version = entry.attributes.version;
  if (version === undefined) version = '';
  let processingState = entry.attributes.processingState;
  if (processingState === undefined) processingState = '';
  let expired = entry.attributes.expired;
  if (expired === undefined) expired = false;
  const buildResource: BuildResource = {
    id: entry.id,
    version,
    processingState,
    expired,
  };
  if (entry.attributes.uploadedDate !== undefined)
    Object.assign(buildResource, { uploadedDate: entry.attributes.uploadedDate });
  const preReleaseVersionId = entry.relationships?.preReleaseVersion?.data?.id;
  const preReleaseVersion = preReleaseVersions.find(
    (includedResource) =>
      includedResource.type === 'preReleaseVersions' && includedResource.id === preReleaseVersionId,
  );
  const marketingVersion = preReleaseVersion?.attributes?.version;
  if (marketingVersion !== undefined) Object.assign(buildResource, { marketingVersion });
  return buildResource;
};
const toBuildResources = ({ data: builds, included = [] }: BuildPage): BuildResource[] =>
  builds.map((entry) => toBuildResource(entry, included));
export const makeBuildsApi = (api: AppStoreConnectRequests, { apps }: { apps: AppsApi }) => {
  /**
   * Return the highest build number already uploaded for an app, or 0 if none exist yet.
   * The caller bumps this by one for the next upload.
   */
  const getLatestBuildNumber = async (bundleId: string): Promise<number> => {
    const appId = await apps.getAppId(bundleId);
    if (!appId) return 0;
    const { data: appleResources } = await api.request<
      ResourceList<{
        version: string;
      }>
    >('GET', `/builds?filter[app]=${appId}&sort=-version&limit=1&fields[builds]=version`);
    const latestBuild = appleResources[0];
    if (latestBuild === undefined) return 0;
    const parsedBuildNumber = Number.parseInt(latestBuild.attributes.version, 10);
    if (Number.isNaN(parsedBuildNumber)) return 0;
    return parsedBuildNumber;
  };
  /**
   * Return the highest marketing version (`CFBundleShortVersionString`) already on App Store Connect
   * for an app - folding both submitted App Store versions and TestFlight pre-release versions - or
   * null when the app has none yet (or no record exists). The caller suggests the next bump from this,
   * so a developer never silently reuses or guesses a version. Compared numerically (see
   * highestAppleMarketingVersion) rather than trusting Apple's lexical sort, which mis-orders `1.10.0`.
   */
  const getLatestMarketingVersion = async (bundleId: string): Promise<string | null> => {
    const appId = await apps.getAppId(bundleId);
    if (!appId) return null;
    const [appStore, preRelease] = await Promise.all([
      api.requestAll<{
        versionString: string;
      }>(`/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`),
      api.requestAll<{
        version: string;
      }>(`/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`),
    ]);
    return highestAppleMarketingVersion([
      ...appStore.map((entry) => entry.attributes.versionString),
      ...preRelease.map((entry) => entry.attributes.version),
    ]);
  };
  /** Poll a freshly uploaded build's processing state (e.g. `PROCESSING`, `VALID`, `INVALID`). */
  const getBuildProcessingState = async (
    bundleId: string,
    buildNumber: number,
  ): Promise<string | null> => {
    const appId = await apps.getAppId(bundleId);
    if (!appId) return null;
    const { data: appleResources } = await api.request<
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
  };
  /** Open a build upload for one version and build number of an app (App Store Connect's replacement for altool). */
  const createBuildUpload = async (
    appId: string,
    version: string,
    buildNumber: number,
    platform: components['schemas']['Platform'],
  ): Promise<string> => {
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
    const { data: buildUpload } = await api.request<components['schemas']['BuildUploadResponse']>(
      'POST',
      '/buildUploads',
      requestDocument,
    );
    return buildUpload.id;
  };
  /** Reserve the IPA (or macOS .pkg) inside a build upload, PUT its parts a few at a time, then mark it uploaded. */
  const uploadBuildFile = async (
    buildUploadId: string,
    fileName: string,
    binaryPath: string,
  ): Promise<void> => {
    const fileByteLength = await readTransportSize(binaryPath);
    let uti = 'com.apple.ipa';
    if (binaryPath.endsWith('.pkg')) uti = 'com.apple.pkg';
    const { id, operations } = await api.reserveAsset(
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
    await api.request<unknown>('PATCH', `/buildUploadFiles/${id}`, commitDocument);
  };
  /** Read a build upload's state, its IPA's delivery state, and every error Apple attached to either. */
  const getBuildUploadStatus = async (buildUploadId: string): Promise<BuildUploadStatus> => {
    const { data: buildUpload, included } = await api.request<
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
  };
  /**
   * Resolve a specific uploaded build by its build number, returning its ASC id plus the current
   * export-compliance answer (`usesNonExemptEncryption`: `true`/`false` once answered, `null` while
   * unanswered). Null when no build with that number exists yet (e.g. still ingesting after upload).
   * The id is what setBuildUsesNonExemptEncryption and linkBuildToDeclaration act on.
   */
  const findBuild = async (
    bundleId: string,
    buildNumber: number,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null> => {
    const appId = await apps.getAppId(bundleId);
    if (!appId) return null;
    const { data: appleResources } = await api.request<
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
  };
  /**
   * Answer a build's export-compliance question directly via its `usesNonExemptEncryption` attribute -
   * the one-call path for the common "no / only-exempt encryption" case (`false`), so App Store Connect
   * stops re-prompting on every upload. Apple accepts this only before the build is submitted for review.
   */
  const setBuildUsesNonExemptEncryption = async (
    buildId: string,
    fieldValue: boolean,
  ): Promise<void> => {
    await api.updateResource(`/builds/${buildId}`, {
      type: 'builds',
      id: buildId,
      attributes: { usesNonExemptEncryption: fieldValue },
    });
  };
  /**
   * List an app's existing App Encryption Declarations (all states) - the reuse candidates for a build
   * that uses non-exempt encryption. Returns `[]` when the app has none or has no ASC record yet.
   */
  const listEncryptionDeclarations = async (
    bundleId: string,
  ): Promise<EncryptionDeclarationResource[]> => {
    const appId = await apps.getAppId(bundleId);
    if (!appId) return [];
    const appleResources = await api.requestAll<{
      appEncryptionDeclarationState: string;
    }>(
      `/apps/${appId}/appEncryptionDeclarations?fields[appEncryptionDeclarations]=appEncryptionDeclarationState&limit=200`,
    );
    return appleResources.map((entry) => ({
      id: entry.id,
      state: entry.attributes.appEncryptionDeclarationState,
    }));
  };
  /**
   * Attach a build to an existing App Encryption Declaration, reusing that one-time, document-backed
   * answer instead of submitting a fresh declaration per build (Apple returns `204 No Content`).
   */
  const linkBuildToDeclaration = async (declarationId: string, buildId: string): Promise<void> => {
    await api.request<unknown>(
      'POST',
      `/appEncryptionDeclarations/${declarationId}/relationships/builds`,
      {
        data: [{ type: 'builds', id: buildId }],
      },
    );
  };
  /** List an app's most recent builds (one page, newest upload first) for the release build picker. */
  const listBuilds = async (appId: string, limit = 25): Promise<BuildResource[]> => {
    const buildPage = await api.request<BuildPage>(
      'GET',
      `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&${BUILD_PAGE_QUERY}`,
    );
    return toBuildResources(buildPage);
  };
  /** Find one build by its `CFBundleVersion` number (the resource id is needed to attach / PATCH it), or null. */
  const findBuildByVersion = async (
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
  ): Promise<BuildResource | null> => {
    const versionFilter = createMarketingVersionFilter(marketingVersion);
    const buildPage = await api.request<BuildPage>(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}${versionFilter}&sort=-uploadedDate&limit=1&${BUILD_PAGE_QUERY}`,
    );
    const [firstBuild] = toBuildResources(buildPage);
    if (firstBuild === undefined) return null;
    return firstBuild;
  };
  /** Attach a (processed, VALID) build to a version - the `relationships/build` PATCH. */
  const selectBuildForVersion = async (versionId: string, buildId: string): Promise<void> => {
    await api.request<unknown>('PATCH', `/appStoreVersions/${versionId}/relationships/build`, {
      data: { type: 'builds', id: buildId },
    });
  };

  return {
    getLatestBuildNumber,
    getLatestMarketingVersion,
    getBuildProcessingState,
    createBuildUpload,
    uploadBuildFile,
    getBuildUploadStatus,
    findBuild,
    setBuildUsesNonExemptEncryption,
    listEncryptionDeclarations,
    linkBuildToDeclaration,
    listBuilds,
    findBuildByVersion,
    selectBuildForVersion,
  };
};
