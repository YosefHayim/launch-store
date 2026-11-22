import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
  AppAvailabilityResource,
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  AppInfoResource,
  AppStoreReviewDetailResource,
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BetaGroupResource,
  BetaTesterResource,
  BuildResource,
  BuildUploadStatus,
  BundleIdCapabilityResource,
  BundleIdResource,
  CertificateResource,
  CustomerReviewResource,
  CustomerReviewResponseResource,
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
  DeviceFamily,
  DeviceResource,
  EncryptionDeclarationResource,
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  FinanceReportQuery,
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterDetailResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
  InAppPurchaseResource,
  IntroductoryOfferCreate,
  IntroductoryOfferResource,
  LeaderboardFormatter,
  ListingLocalization,
  LocalizationResource,
  MerchantIdResource,
  NewAppEvent,
  NewUserInvitation,
  OfferCodeCreate,
  OfferCodeResource,
  PassTypeIdResource,
  PhasedReleaseResource,
  PreviewResource,
  PreviewSetResource,
  PricePointResource,
  ProfileResource,
  PromotedPurchaseCreate,
  PromotedPurchaseResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  ReviewScreenshotResource,
  ReviewSubmissionResource,
  SalesReportQuery,
  SandboxTesterResource,
  ScreenshotResource,
  ScreenshotSetResource,
  SubscriptionGroupResource,
  SubscriptionResource,
  UserInvitationResource,
  UserResource,
  VersionExperimentResource,
  WinBackOfferCreate,
  WinBackOfferResource,
} from '@/types/appleCatalog.js';
import type { AscKey } from '@/types/credentials.js';
import type { components } from '@/generated/apple/schema.js';
import { platform as detectOperatingSystem } from 'node:os';
import { retryAppleTransportRequest } from '@/apple/transportHelpers.js';
import type { AscHost } from './connect/host.js';
import { ConnectApps } from './connect/apps.js';
import { ConnectBuilds } from './connect/builds.js';
import { ConnectVersions } from './connect/versions.js';
import { ConnectAppClips } from './connect/app-clips.js';
import { ConnectSigning } from './connect/signing.js';
import { ConnectSandbox } from './connect/sandbox.js';
import { ConnectPurchases } from './connect/purchases.js';
import { ConnectTestflight } from './connect/testflight.js';
import { ConnectAccessibility } from './connect/accessibility.js';
import { ConnectAvailability } from './connect/availability.js';
import { ConnectCustomProductPages } from './connect/custom-product-pages.js';
import { ConnectExperiments } from './connect/experiments.js';
import { ConnectPricing } from './connect/pricing.js';
import { ConnectReviews } from './connect/reviews.js';
import { ConnectTeam } from './connect/team.js';
import { ConnectReports } from './connect/reports.js';
import { ConnectEvents } from './connect/events.js';
import { ConnectScreenshots } from './connect/screenshots.js';
import { ConnectDistribution } from './connect/distribution.js';
import { ConnectGameCenter } from './connect/game-center.js';
import {
  API_ORIGIN,
  BASE_URL,
  APP_STORE_PROFILE_TYPE,
  AD_HOC_PROFILE_TYPE,
  AscRequestError,
  isRetryableAscError,
  isRejectedToken,
  isRetryableIdempotentFailure,
  md5Hex,
  forgetToken,
  reusableToken,
  clockSkewHint,
  describeErrors,
  parseErrorCodes,
} from './connect/shared.js';
import type {
  ProvisioningProfileType,
  LocaleCopy,
  ResourceList,
  AppInfoStates,
  VersionStates,
  ResourceSingle,
  AppleResource,
  PagedList,
  UploadOperation,
  AssetReservation,
} from './connect/shared.js';

export class AppStoreConnectClient implements AscHost {
  private readonly apps: ConnectApps;
  private readonly builds: ConnectBuilds;
  private readonly versions: ConnectVersions;
  private readonly appClips: ConnectAppClips;
  private readonly signing: ConnectSigning;
  private readonly sandbox: ConnectSandbox;
  private readonly purchases: ConnectPurchases;
  private readonly testflight: ConnectTestflight;
  private readonly accessibility: ConnectAccessibility;
  private readonly availability: ConnectAvailability;
  private readonly customProductPages: ConnectCustomProductPages;
  private readonly experiments: ConnectExperiments;
  private readonly pricing: ConnectPricing;
  private readonly reviews: ConnectReviews;
  private readonly team: ConnectTeam;
  private readonly reports: ConnectReports;
  private readonly events: ConnectEvents;
  private readonly screenshots: ConnectScreenshots;
  private readonly distribution: ConnectDistribution;
  private readonly gameCenter: ConnectGameCenter;

  constructor(
    private readonly key: AscKey,
    private readonly operatingSystem: NodeJS.Platform = detectOperatingSystem(),
  ) {
    this.apps = new ConnectApps(this);
    this.builds = new ConnectBuilds(this);
    this.versions = new ConnectVersions(this);
    this.appClips = new ConnectAppClips(this);
    this.signing = new ConnectSigning(this);
    this.sandbox = new ConnectSandbox(this);
    this.purchases = new ConnectPurchases(this);
    this.testflight = new ConnectTestflight(this);
    this.accessibility = new ConnectAccessibility(this);
    this.availability = new ConnectAvailability(this);
    this.customProductPages = new ConnectCustomProductPages(this);
    this.experiments = new ConnectExperiments(this);
    this.pricing = new ConnectPricing(this);
    this.reviews = new ConnectReviews(this);
    this.team = new ConnectTeam(this);
    this.reports = new ConnectReports(this);
    this.events = new ConnectEvents(this);
    this.screenshots = new ConnectScreenshots(this);
    this.distribution = new ConnectDistribution(this);
    this.gameCenter = new ConnectGameCenter(this);
  }

  async token(): Promise<string> {
    return reusableToken(this.key);
  }

  async request<T>(method: string, pathOrUrl: string, requestDocument?: unknown): Promise<T> {
    // Transparent backoff on Apple's transient failures (429 rate-limit / 5xx). A fresh token is
    // minted per attempt, so a retry that straddles the 19-minute TTL re-signs rather than 401s.
    // A write that lost its connection may already have landed, so only a GET retries one.
    let isRetryableFailure = isRetryableAscError;
    if (method === 'GET') isRetryableFailure = isRetryableIdempotentFailure;
    const requestWithBackoff = () =>
      retryAppleTransportRequest(() => this.requestOnce<T>(method, pathOrUrl, requestDocument), {
        isRetryableFailure,
      });
    try {
      return await requestWithBackoff();
    } catch (requestFailure) {
      if (!isRejectedToken(requestFailure)) throw requestFailure;
      forgetToken(this.key);
      return requestWithBackoff();
    }
  }

  private async requestOnce<T>(
    method: string,
    pathOrUrl: string,
    requestDocument?: unknown,
  ): Promise<T> {
    let url = pathOrUrl;
    if (!pathOrUrl.startsWith('http')) url = `${BASE_URL}${pathOrUrl}`;
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
    };
    const requestInit: RequestInit = { method, headers: requestHeaders };
    if (requestDocument !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(requestDocument);
    }
    const appleResponse = await fetch(url, requestInit);
    const isEmptyResponse = appleResponse.status == 204;

    if (isEmptyResponse) return undefined as T;

    const responseText = await appleResponse.text();
    const isFailedResponse = appleResponse.ok == false;

    if (isFailedResponse) {
      // A 401 most often means a wrong/expired token - but the sneaky cause is a skewed local clock,
      // since `exp`/`iat` are signed off it. Apple's `Date` header is the authoritative reference.
      let clockHint = '';
      if (appleResponse.status === 401)
        clockHint = clockSkewHint({
          appleDate: appleResponse.headers.get('date'),
          nowMs: Date.now(),
          platform: this.operatingSystem,
        });
      throw new AscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${appleResponse.status}): ${describeErrors(responseText)}${clockHint}`,
        appleResponse.status,
        parseErrorCodes(responseText),
      );
    }
    const responseDocument: unknown = JSON.parse(responseText);

    return responseDocument as T;
  }

  v2(path: string): string {
    return `${API_ORIGIN}/v2${path}`;
  }

  async requestAll<A>(path: string): Promise<AppleResource<A>[]> {
    const pages = await this.requestPages<PagedList<A>>(path);
    return pages.flatMap((page) => page.data);
  }

  async requestPages<Page extends { links?: { next?: string } }>(path: string): Promise<Page[]> {
    const pages: Page[] = [];
    let next: string | undefined = path;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: Page = await this.request<Page>('GET', next);
      pages.push(page);
      next = page.links?.next;
    }
    return pages;
  }

  async getOptional<T>(load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (error) {
      if (error instanceof AscRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async createResource<A = unknown>(
    path: string,
    member: {
      type: string;
      attributes?: object;
      relationships?: object;
    },
  ): Promise<{
    id: string;
    attributes: A;
  }> {
    const { data: appleResources } = await this.request<ResourceSingle<A>>('POST', path, {
      data: member,
    });
    return appleResources;
  }

  async updateResource(
    path: string,
    member: {
      type: string;
      id: string;
      attributes: object;
    },
  ): Promise<void> {
    await this.request<unknown>('PATCH', path, { data: member });
  }

  async deleteResource(path: string): Promise<void> {
    await this.request<unknown>('DELETE', path);
  }

  async reserveAsset(
    type: string,
    parent: {
      relationship: string;
      type: string;
      id: string;
    },
    fileName: string,
    fileSize: number,
    assetAttributes: Record<string, string> = {},
  ): Promise<{
    id: string;
    operations: UploadOperation[];
  }> {
    const reservation = await this.request<AssetReservation>('POST', `/${type}`, {
      data: {
        type,
        attributes: { fileName, fileSize, ...assetAttributes },
        relationships: { [parent.relationship]: { data: { type: parent.type, id: parent.id } } },
      },
    });
    let operations = reservation.data.attributes.uploadOperations;
    if (operations === undefined) operations = [];
    return { id: reservation.data.id, operations };
  }

  async commitAsset(type: string, id: string, bytes: Buffer): Promise<void> {
    await this.request<unknown>('PATCH', `/${type}/${id}`, {
      data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5Hex(bytes) } },
    });
  }

  async getAppId(bundleId: string): Promise<string | null> {
    return this.apps.getAppId(bundleId);
  }

  async getEditableAppInfoId(appId: string): Promise<string | null> {
    return this.apps.getEditableAppInfoId(appId);
  }

  async getCurrentAppInfoId(appId: string): Promise<string | null> {
    return this.apps.getCurrentAppInfoId(appId);
  }

  async listAppInfoStates(appId: string): Promise<ResourceList<AppInfoStates>['data']> {
    return this.apps.listAppInfoStates(appId);
  }

  async listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]> {
    return this.apps.listAppInfoLocalizations(appInfoId);
  }

  async listAccountDeletionUrls(appInfoId: string): Promise<
    {
      locale: string;
      url: string;
    }[]
  > {
    return this.apps.listAccountDeletionUrls(appInfoId);
  }

  async createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    return this.apps.createAppInfoLocalization(appInfoId, locale, fields);
  }

  async updateAppInfoLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    return this.apps.updateAppInfoLocalization(localizationId, fields);
  }

  async assertReady(): Promise<void> {
    return this.apps.assertReady();
  }

  async checkRequiredAgreements(): Promise<boolean> {
    return this.apps.checkRequiredAgreements();
  }

  async resolveTeamId(): Promise<string | null> {
    return this.apps.resolveTeamId();
  }

  async listAppNames(): Promise<string[]> {
    return this.apps.listAppNames();
  }

  async listApps(): Promise<{ id: string; name: string; bundleId: string | null }[]> {
    return this.apps.listApps();
  }

  async getAppInfo(appId: string): Promise<AppInfoResource | null> {
    return this.apps.getAppInfo(appId);
  }

  async updateAppInfoCategories(
    appInfoId: string,
    categories: {
      primaryCategoryId?: string;
      secondaryCategoryId?: string | null;
    },
  ): Promise<void> {
    return this.apps.updateAppInfoCategories(appInfoId, categories);
  }

  async getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null> {
    return this.apps.getAgeRatingDeclaration(appInfoId);
  }

  async updateAgeRatingDeclaration(
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void> {
    return this.apps.updateAgeRatingDeclaration(declarationId, attributes);
  }

  async getLatestBuildNumber(bundleId: string): Promise<number> {
    return this.builds.getLatestBuildNumber(bundleId);
  }

  async getLatestMarketingVersion(bundleId: string): Promise<string | null> {
    return this.builds.getLatestMarketingVersion(bundleId);
  }

  async getBuildProcessingState(bundleId: string, buildNumber: number): Promise<string | null> {
    return this.builds.getBuildProcessingState(bundleId, buildNumber);
  }

  async createBuildUpload(
    appId: string,
    version: string,
    buildNumber: number,
    platform: components['schemas']['Platform'],
  ): Promise<string> {
    return this.builds.createBuildUpload(appId, version, buildNumber, platform);
  }

  async uploadBuildFile(
    buildUploadId: string,
    fileName: string,
    binaryPath: string,
  ): Promise<void> {
    return this.builds.uploadBuildFile(buildUploadId, fileName, binaryPath);
  }

  async getBuildUploadStatus(buildUploadId: string): Promise<BuildUploadStatus> {
    return this.builds.getBuildUploadStatus(buildUploadId);
  }

  async findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null> {
    return this.builds.findBuild(bundleId, buildNumber);
  }

  async setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void> {
    return this.builds.setBuildUsesNonExemptEncryption(buildId, fieldValue);
  }

  async listEncryptionDeclarations(bundleId: string): Promise<EncryptionDeclarationResource[]> {
    return this.builds.listEncryptionDeclarations(bundleId);
  }

  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    return this.builds.linkBuildToDeclaration(declarationId, buildId);
  }

  async listBuilds(appId: string, limit = 25): Promise<BuildResource[]> {
    return this.builds.listBuilds(appId, limit);
  }

  async findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
  ): Promise<BuildResource | null> {
    return this.builds.findBuildByVersion(appId, buildNumber, marketingVersion);
  }

  async getEditableVersionId(appId: string): Promise<string | null> {
    return this.versions.getEditableVersionId(appId);
  }

  async getCurrentVersionId(appId: string): Promise<string | null> {
    return this.versions.getCurrentVersionId(appId);
  }

  async listVersionStates(appId: string): Promise<ResourceList<VersionStates>['data']> {
    return this.versions.listVersionStates(appId);
  }

  async listVersionLocalizations(versionId: string): Promise<ListingLocalization[]> {
    return this.versions.listVersionLocalizations(versionId);
  }

  async createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    return this.versions.createVersionLocalization(versionId, locale, fields);
  }

  async updateVersionLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    return this.versions.updateVersionLocalization(localizationId, fields);
  }

  async findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> {
    return this.versions.findEditableAppStoreVersion(appId, platform);
  }

  async getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null> {
    return this.versions.getAppStoreReviewDetail(versionId);
  }

  async createAppStoreReviewDetail(
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{
    id: string;
  }> {
    return this.versions.createAppStoreReviewDetail(versionId, attributes);
  }

  async updateAppStoreReviewDetail(
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void> {
    return this.versions.updateAppStoreReviewDetail(detailId, attributes);
  }

  async listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]> {
    return this.versions.listAppStoreVersions(appId, platform);
  }

  async createAppStoreVersion(
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource> {
    return this.versions.createAppStoreVersion(appId, input);
  }

  async updateAppStoreVersion(
    versionId: string,
    input: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void> {
    return this.versions.updateAppStoreVersion(versionId, input);
  }

  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    return this.versions.selectBuildForVersion(versionId, buildId);
  }

  async listAppStoreVersionLocalizations(
    versionId: string,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    return this.versions.listAppStoreVersionLocalizations(versionId);
  }

  async createAppStoreVersionLocalization(
    versionId: string,
    input: {
      locale: string;
      whatsNew: string;
    },
  ): Promise<AppStoreVersionLocalizationResource> {
    return this.versions.createAppStoreVersionLocalization(versionId, input);
  }

  async updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void> {
    return this.versions.updateAppStoreVersionLocalization(localizationId, whatsNew);
  }

  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    return this.versions.getPhasedRelease(versionId);
  }

  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    return this.versions.createPhasedRelease(versionId);
  }

  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    return this.versions.updatePhasedRelease(phasedReleaseId, phasedReleaseState);
  }

  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    return this.versions.deletePhasedRelease(phasedReleaseId);
  }

  async listReviewSubmissions(
    appId: string,
    platform: string,
  ): Promise<ReviewSubmissionResource[]> {
    return this.versions.listReviewSubmissions(appId, platform);
  }

  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    return this.versions.createReviewSubmission(appId, platform);
  }

  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    return this.versions.addReviewSubmissionItem(submissionId, versionId);
  }

  async addExperimentReviewSubmissionItem(
    submissionId: string,
    experimentId: string,
  ): Promise<void> {
    return this.versions.addExperimentReviewSubmissionItem(submissionId, experimentId);
  }

  async submitReviewSubmission(submissionId: string): Promise<void> {
    return this.versions.submitReviewSubmission(submissionId);
  }

  async createAppStoreVersionReleaseRequest(versionId: string): Promise<void> {
    return this.versions.createAppStoreVersionReleaseRequest(versionId);
  }

  async cancelReviewSubmission(submissionId: string): Promise<void> {
    return this.versions.cancelReviewSubmission(submissionId);
  }

  async getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource> {
    return this.versions.getReviewSubmission(submissionId);
  }

  async listAppClips(appId: string): Promise<AppClipResource[]> {
    return this.appClips.listAppClips(appId);
  }

  async listAppClipDefaultExperiences(
    appClipId: string,
  ): Promise<AppClipDefaultExperienceResource[]> {
    return this.appClips.listAppClipDefaultExperiences(appClipId);
  }

  async createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{
    id: string;
  }> {
    return this.appClips.createAppClipDefaultExperience(appClipId, versionId, action);
  }

  async updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void> {
    return this.appClips.updateAppClipDefaultExperienceAction(experienceId, action);
  }

  async listAppClipDefaultExperienceLocalizations(
    experienceId: string,
  ): Promise<AppClipLocalizationResource[]> {
    return this.appClips.listAppClipDefaultExperienceLocalizations(experienceId);
  }

  async createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void> {
    return this.appClips.createAppClipDefaultExperienceLocalization(experienceId, locale, subtitle);
  }

  async updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void> {
    return this.appClips.updateAppClipDefaultExperienceLocalization(localizationId, subtitle);
  }

  async findBundleId(identifier: string): Promise<BundleIdResource | null> {
    return this.signing.findBundleId(identifier);
  }

  async createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> {
    return this.signing.createBundleId(identifier, name, bundleIdPlatform);
  }

  async listDistributionCertificates(): Promise<CertificateResource[]> {
    return this.signing.listDistributionCertificates();
  }

  async createCertificate(csrContent: string): Promise<CertificateResource> {
    return this.signing.createCertificate(csrContent);
  }

  async findProfileByName(name: string): Promise<ProfileResource | null> {
    return this.signing.findProfileByName(name);
  }

  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: ProvisioningProfileType = APP_STORE_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    return this.signing.createAppStoreProfile(name, bundleIdResourceId, certificateId, profileType);
  }

  async deleteProfile(id: string): Promise<void> {
    return this.signing.deleteProfile(id);
  }

  async listDevices(): Promise<DeviceResource[]> {
    return this.signing.listDevices();
  }

  async findDeviceByUdid(udid: string): Promise<DeviceResource | null> {
    return this.signing.findDeviceByUdid(udid);
  }

  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    return this.signing.registerDevice(udid, name);
  }

  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    return this.signing.createAdHocProfile(
      name,
      bundleIdResourceId,
      certificateId,
      deviceIds,
      profileType,
    );
  }

  async listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Promise<BundleIdCapabilityResource[]> {
    return this.signing.listBundleIdCapabilities(bundleIdResourceId);
  }

  async listProfilesForBundleId(bundleIdResourceId: string): Promise<ProfileResource[]> {
    return this.signing.listProfilesForBundleId(bundleIdResourceId);
  }

  async enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource> {
    return this.signing.enableCapability(bundleIdResourceId, capabilityType);
  }

  async disableCapability(capabilityId: string): Promise<void> {
    return this.signing.disableCapability(capabilityId);
  }

  async listSandboxTesters(): Promise<SandboxTesterResource[]> {
    return this.sandbox.listSandboxTesters();
  }

  async clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void> {
    return this.sandbox.clearSandboxTesterPurchaseHistory(testerIds);
  }

  async listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]> {
    return this.purchases.listInAppPurchases(appId);
  }

  async createInAppPurchase(
    appId: string,
    input: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Promise<InAppPurchaseResource> {
    return this.purchases.createInAppPurchase(appId, input);
  }

  async listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]> {
    return this.purchases.listInAppPurchaseLocalizations(iapId);
  }

  async createInAppPurchaseLocalization(
    iapId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    return this.purchases.createInAppPurchaseLocalization(iapId, copy);
  }

  async listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]> {
    return this.purchases.listSubscriptionGroups(appId);
  }

  async createSubscriptionGroup(
    appId: string,
    referenceName: string,
  ): Promise<SubscriptionGroupResource> {
    return this.purchases.createSubscriptionGroup(appId, referenceName);
  }

  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    return this.purchases.listSubscriptionGroupLocalizations(groupId);
  }

  async createSubscriptionGroupLocalization(
    groupId: string,
    copy: Omit<LocaleCopy, 'description'>,
  ): Promise<LocalizationResource> {
    return this.purchases.createSubscriptionGroupLocalization(groupId, copy);
  }

  async listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    return this.purchases.listSubscriptions(groupId);
  }

  async createSubscription(
    groupId: string,
    input: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Promise<SubscriptionResource> {
    return this.purchases.createSubscription(groupId, input);
  }

  async listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]> {
    return this.purchases.listSubscriptionLocalizations(subscriptionId);
  }

  async createSubscriptionLocalization(
    subscriptionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    return this.purchases.createSubscriptionLocalization(subscriptionId, copy);
  }

  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    return this.purchases.subscriptionHasPrice(subscriptionId);
  }

  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    return this.purchases.findSubscriptionPricePoint(subscriptionId, territory, customerPrice);
  }

  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    return this.purchases.createSubscriptionPrice(subscriptionId, pricePointId);
  }

  async listSubscriptionOfferCodes(subscriptionId: string): Promise<OfferCodeResource[]> {
    return this.purchases.listSubscriptionOfferCodes(subscriptionId);
  }

  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    return this.purchases.createSubscriptionOfferCode(input);
  }

  async deactivateOfferCode(offerCodeId: string): Promise<void> {
    return this.purchases.deactivateOfferCode(offerCodeId);
  }

  async createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> {
    return this.purchases.createOfferCodeOneTimeUseBatch(
      offerCodeId,
      numberOfCodes,
      expirationDate,
    );
  }

  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    return this.purchases.createOfferCodeCustomCode(
      offerCodeId,
      customCode,
      numberOfCodes,
      expirationDate,
    );
  }

  async listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]> {
    return this.purchases.listPromotionalOffers(subscriptionId);
  }

  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    return this.purchases.createPromotionalOffer(input);
  }

  async listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferResource[]> {
    return this.purchases.listIntroductoryOffers(subscriptionId);
  }

  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    return this.purchases.createIntroductoryOffer(input);
  }

  async listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]> {
    return this.purchases.listWinBackOffers(subscriptionId);
  }

  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    return this.purchases.createWinBackOffer(input);
  }

  async listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]> {
    return this.purchases.listPromotedPurchases(appId);
  }

  async createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    return this.purchases.createPromotedPurchase(input);
  }

  async reorderPromotedPurchases(appId: string, orderedIds: readonly string[]): Promise<void> {
    return this.purchases.reorderPromotedPurchases(appId, orderedIds);
  }

  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    return this.purchases.inAppPurchaseHasPrice(iapId);
  }

  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    return this.purchases.findInAppPurchasePricePoint(iapId, territory, customerPrice);
  }

  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    return this.purchases.createInAppPurchasePriceSchedule(iapId, baseTerritory, pricePointId);
  }

  async listBetaGroups(appId: string): Promise<BetaGroupResource[]> {
    return this.testflight.listBetaGroups(appId);
  }

  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    return this.testflight.findBetaGroupByName(appId, name);
  }

  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    return this.testflight.createBetaGroup(appId, name);
  }

  async listBetaTestersInGroup(groupId: string): Promise<BetaTesterResource[]> {
    return this.testflight.listBetaTestersInGroup(groupId);
  }

  async findBetaTesterByEmail(email: string): Promise<BetaTesterResource | null> {
    return this.testflight.findBetaTesterByEmail(email);
  }

  async createBetaTester(
    groupId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<BetaTesterResource> {
    return this.testflight.createBetaTester(groupId, input);
  }

  async addTestersToGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    return this.testflight.addTestersToGroup(groupId, testerIds);
  }

  async removeTestersFromGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    return this.testflight.removeTestersFromGroup(groupId, testerIds);
  }

  async listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    return this.testflight.listBetaFeedbackCrashSubmissions(appId, query);
  }

  async listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
    return this.testflight.listBetaFeedbackScreenshotSubmissions(appId, query);
  }

  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    return this.testflight.downloadBetaFeedbackScreenshot(url);
  }

  async listBetaBuildLocalizations(buildId: string): Promise<BetaBuildLocalizationResource[]> {
    return this.testflight.listBetaBuildLocalizations(buildId);
  }

  async createBetaBuildLocalization(
    buildId: string,
    locale: string,
    whatsNew: string,
  ): Promise<void> {
    return this.testflight.createBetaBuildLocalization(buildId, locale, whatsNew);
  }

  async updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void> {
    return this.testflight.updateBetaBuildLocalization(localizationId, whatsNew);
  }

  async getBetaAppReviewSubmission(
    buildId: string,
  ): Promise<BetaAppReviewSubmissionResource | null> {
    return this.testflight.getBetaAppReviewSubmission(buildId);
  }

  async createBetaAppReviewSubmission(buildId: string): Promise<void> {
    return this.testflight.createBetaAppReviewSubmission(buildId);
  }

  async listAccessibilityDeclarations(appId: string): Promise<AccessibilityDeclarationResource[]> {
    return this.accessibility.listAccessibilityDeclarations(appId);
  }

  async createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource> {
    return this.accessibility.createAccessibilityDeclaration(appId, deviceFamily, support);
  }

  async updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & {
      publish?: boolean;
    },
  ): Promise<void> {
    return this.accessibility.updateAccessibilityDeclaration(declarationId, changes);
  }

  async getAppAvailability(appId: string): Promise<AppAvailabilityResource | null> {
    return this.availability.getAppAvailability(appId);
  }

  async createAppAvailability(
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void> {
    return this.availability.createAppAvailability(appId, input);
  }

  async updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void> {
    return this.availability.updateAppAvailabilityTerritories(availabilityId, territories);
  }

  async listCustomProductPages(appId: string): Promise<CustomProductPageResource[]> {
    return this.customProductPages.listCustomProductPages(appId);
  }

  async createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource> {
    return this.customProductPages.createCustomProductPage(appId, name);
  }

  async listCustomProductPageVersions(pageId: string): Promise<CustomProductPageVersionResource[]> {
    return this.customProductPages.listCustomProductPageVersions(pageId);
  }

  async listCustomProductPageLocalizations(
    versionId: string,
  ): Promise<CustomProductPageLocalizationResource[]> {
    return this.customProductPages.listCustomProductPageLocalizations(versionId);
  }

  async createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void> {
    return this.customProductPages.createCustomProductPageLocalization(
      versionId,
      locale,
      promotionalText,
    );
  }

  async updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void> {
    return this.customProductPages.updateCustomProductPageLocalization(
      localizationId,
      promotionalText,
    );
  }

  async listVersionExperiments(appId: string): Promise<VersionExperimentResource[]> {
    return this.experiments.listVersionExperiments(appId);
  }

  async createVersionExperiment(
    appId: string,
    input: {
      name: string;
      platform: string;
      trafficProportion: number;
    },
  ): Promise<VersionExperimentResource> {
    return this.experiments.createVersionExperiment(appId, input);
  }

  async listExperimentTreatments(experimentId: string): Promise<ExperimentTreatmentResource[]> {
    return this.experiments.listExperimentTreatments(experimentId);
  }

  async createExperimentTreatment(
    experimentId: string,
    input: {
      name: string;
      appIconName?: string;
    },
  ): Promise<ExperimentTreatmentResource> {
    return this.experiments.createExperimentTreatment(experimentId, input);
  }

  async startVersionExperiment(experimentId: string): Promise<void> {
    return this.experiments.startVersionExperiment(experimentId);
  }

  async listExperimentTreatmentLocalizations(
    treatmentId: string,
  ): Promise<ExperimentTreatmentLocalizationResource[]> {
    return this.experiments.listExperimentTreatmentLocalizations(treatmentId);
  }

  async createExperimentTreatmentLocalization(
    treatmentId: string,
    locale: string,
  ): Promise<ExperimentTreatmentLocalizationResource> {
    return this.experiments.createExperimentTreatmentLocalization(treatmentId, locale);
  }

  async findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    return this.pricing.findAppPricePoint(appId, territory, customerPrice);
  }

  async getCurrentAppPrice(appId: string, territory: string): Promise<string | null> {
    return this.pricing.getCurrentAppPrice(appId, territory);
  }

  async createAppPriceSchedule(
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    return this.pricing.createAppPriceSchedule(appId, baseTerritory, pricePointId);
  }

  async listCustomerReviews(
    appId: string,
    filters: {
      rating?: number;
      territory?: string;
    } = {},
  ): Promise<CustomerReviewResource[]> {
    return this.reviews.listCustomerReviews(appId, filters);
  }

  async getCustomerReviewResponse(
    reviewId: string,
  ): Promise<CustomerReviewResponseResource | null> {
    return this.reviews.getCustomerReviewResponse(reviewId);
  }

  async createCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource> {
    return this.reviews.createCustomerReviewResponse(reviewId, responseBody);
  }

  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    return this.reviews.deleteCustomerReviewResponse(responseId);
  }

  async listUsers(): Promise<UserResource[]> {
    return this.team.listUsers();
  }

  async listUserInvitations(): Promise<UserInvitationResource[]> {
    return this.team.listUserInvitations();
  }

  async inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource> {
    return this.team.inviteUser(invite);
  }

  async deleteUser(userId: string): Promise<void> {
    return this.team.deleteUser(userId);
  }

  async cancelUserInvitation(invitationId: string): Promise<void> {
    return this.team.cancelUserInvitation(invitationId);
  }

  async getSalesReport(query: SalesReportQuery): Promise<Buffer> {
    return this.reports.getSalesReport(query);
  }

  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    return this.reports.getFinanceReport(query);
  }

  async listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> {
    return this.reports.listAnalyticsReportRequests(appId, accessType);
  }

  async createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> {
    return this.reports.createAnalyticsReportRequest(appId, accessType);
  }

  async listAnalyticsReports(
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    } = {},
  ): Promise<AnalyticsReportResource[]> {
    return this.reports.listAnalyticsReports(requestId, filters);
  }

  async listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    } = {},
  ): Promise<AnalyticsReportInstanceResource[]> {
    return this.reports.listAnalyticsReportInstances(reportId, filters);
  }

  async listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]> {
    return this.reports.listAnalyticsReportSegments(instanceId);
  }

  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    return this.reports.downloadAnalyticsSegment(url);
  }

  async listAppEvents(appId: string): Promise<AppEventResource[]> {
    return this.events.listAppEvents(appId);
  }

  async listAppEventLocalizations(eventId: string): Promise<AppEventLocalizationResource[]> {
    return this.events.listAppEventLocalizations(eventId);
  }

  async createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource> {
    return this.events.createAppEvent(appId, attributes);
  }

  async deleteAppEvent(eventId: string): Promise<void> {
    return this.events.deleteAppEvent(eventId);
  }

  async createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    return this.events.createAppEventLocalization(eventId, locale, attributes);
  }

  async updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    return this.events.updateAppEventLocalization(localizationId, attributes);
  }

  async listScreenshotSets(versionLocalizationId: string): Promise<ScreenshotSetResource[]> {
    return this.screenshots.listScreenshotSets(versionLocalizationId);
  }

  async createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.screenshots.createScreenshotSet(versionLocalizationId, displayType);
  }

  async listTreatmentScreenshotSets(
    treatmentLocalizationId: string,
  ): Promise<ScreenshotSetResource[]> {
    return this.screenshots.listTreatmentScreenshotSets(treatmentLocalizationId);
  }

  async createTreatmentScreenshotSet(
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.screenshots.createTreatmentScreenshotSet(treatmentLocalizationId, displayType);
  }

  async listScreenshots(setId: string): Promise<ScreenshotResource[]> {
    return this.screenshots.listScreenshots(setId);
  }

  async deleteScreenshot(screenshotId: string): Promise<void> {
    return this.screenshots.deleteScreenshot(screenshotId);
  }

  async reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void> {
    return this.screenshots.reorderScreenshots(setId, screenshotIds);
  }

  async uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<string> {
    return this.screenshots.uploadScreenshot(setId, fileName, filePath);
  }

  async getSubscriptionReviewScreenshot(
    subscriptionId: string,
  ): Promise<ReviewScreenshotResource | null> {
    return this.screenshots.getSubscriptionReviewScreenshot(subscriptionId);
  }

  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> {
    return this.screenshots.uploadSubscriptionReviewScreenshot(subscriptionId, fileName, filePath);
  }

  async listPreviewSets(versionLocalizationId: string): Promise<PreviewSetResource[]> {
    return this.screenshots.listPreviewSets(versionLocalizationId);
  }

  async createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> {
    return this.screenshots.createPreviewSet(versionLocalizationId, previewType);
  }

  async listPreviews(setId: string): Promise<PreviewResource[]> {
    return this.screenshots.listPreviews(setId);
  }

  async uploadPreview(setId: string, fileName: string, filePath: string): Promise<void> {
    return this.screenshots.uploadPreview(setId, fileName, filePath);
  }

  async listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]> {
    return this.distribution.listAlternativeDistributionDomains();
  }

  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    return this.distribution.createAlternativeDistributionDomain(domain, referenceName);
  }

  async listAlternativeDistributionKeys(): Promise<AlternativeDistributionKeyResource[]> {
    return this.distribution.listAlternativeDistributionKeys();
  }

  async createAlternativeDistributionKey(publicKey: string): Promise<{
    id: string;
  }> {
    return this.distribution.createAlternativeDistributionKey(publicKey);
  }

  async listMerchantIds(): Promise<MerchantIdResource[]> {
    return this.distribution.listMerchantIds();
  }

  async createMerchantId(identifier: string, name: string): Promise<void> {
    return this.distribution.createMerchantId(identifier, name);
  }

  async listPassTypeIds(): Promise<PassTypeIdResource[]> {
    return this.distribution.listPassTypeIds();
  }

  async createPassTypeId(identifier: string, name: string): Promise<void> {
    return this.distribution.createPassTypeId(identifier, name);
  }

  async getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null> {
    return this.gameCenter.getGameCenterDetail(appId);
  }

  async createGameCenterDetail(appId: string): Promise<GameCenterDetailResource> {
    return this.gameCenter.createGameCenterDetail(appId);
  }

  async listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]> {
    return this.gameCenter.listGameCenterAchievements(detailId);
  }

  async createGameCenterAchievement(
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    return this.gameCenter.createGameCenterAchievement(detailId, attributes);
  }

  async createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void> {
    return this.gameCenter.createGameCenterAchievementLocalization(versionId, fields);
  }

  async listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]> {
    return this.gameCenter.listGameCenterLeaderboards(detailId);
  }

  async createGameCenterLeaderboard(
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    return this.gameCenter.createGameCenterLeaderboard(detailId, attributes);
  }

  async createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      formatterOverride?: LeaderboardFormatter;
    },
  ): Promise<void> {
    return this.gameCenter.createGameCenterLeaderboardLocalization(versionId, fields);
  }
}
