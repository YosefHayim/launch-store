// Sends every App Store Connect request Launch makes for a live app.

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
} from '../types/apple-catalog.ts';
import type { AscKey } from '../types/credentials.ts';
import type { components } from '../apple-api-types.ts';
import { platform as detectOperatingSystem } from 'node:os';
import { retryAppleTransportRequest } from './transport-helpers.ts';
import type { AscHost } from './host.ts';
import { ConnectApps } from './apps.ts';
import { ConnectBuilds } from './builds.ts';
import { ConnectVersions } from './versions.ts';
import { ConnectAppClips } from './app-store-connect-app-clips.ts';
import { ConnectSigning } from './signing.ts';
import { ConnectSandbox } from './app-store-connect-sandbox.ts';
import { ConnectPurchases } from './purchases.ts';
import { ConnectTestflight } from './testflight.ts';
import { ConnectAccessibility } from './app-store-connect-accessibility.ts';
import { ConnectAvailability } from './app-store-connect-availability.ts';
import { ConnectCustomProductPages } from './app-store-connect-custom-product-pages.ts';
import { ConnectExperiments } from './experiments.ts';
import { ConnectPricing } from './pricing.ts';
import { ConnectReviews } from './app-store-connect-reviews.ts';
import { ConnectTeam } from './app-store-connect-team.ts';
import { ConnectReports } from './app-store-connect-reports.ts';
import { ConnectEvents } from './app-store-connect-events.ts';
import { ConnectScreenshots } from './screenshots.ts';
import { ConnectDistribution } from './distribution.ts';
import { ConnectGameCenter } from './app-store-connect-game-center.ts';
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
} from './shared.ts';
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
} from './shared.ts';
import type { AppleListQuery } from './list-query.ts';

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

    if (method == 'GET') isRetryableFailure = isRetryableIdempotentFailure;

    const client = this;

    function requestWithBackoff() {
      function requestOnceNow() {
        return client.requestOnce<T>(method, pathOrUrl, requestDocument);
      }

      return retryAppleTransportRequest(requestOnceNow, {
        isRetryableFailure,
      });
    }

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

    if (requestDocument != null) {
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

      if (appleResponse.status == 401)
        clockHint = clockSkewHint({
          appleDate: appleResponse.headers.get('date'),
          nowMs: Date.now(),
          platform: this.operatingSystem,
        });

      const errors = describeErrors(responseText);
      const errorCodes = parseErrorCodes(responseText);

      throw new AscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${appleResponse.status}): ${errors}${clockHint}`,
        appleResponse.status,
        errorCodes,
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

    function readPiece(page: { data: AppleResource<A>[]; links?: { next?: string } }) {
      return page.data;
    }

    return pages.flatMap(readPiece);
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
      if (error instanceof AscRequestError && error.status == 404) return null;

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

    if (operations == null) operations = [];

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

  async listAppInfoStates(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ResourceList<AppInfoStates>['data']> {
    return this.apps.listAppInfoStates(appId, listQuery);
  }

  async listAppInfoLocalizations(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    return this.apps.listAppInfoLocalizations(appInfoId, listQuery);
  }

  async listAccountDeletionUrls(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<
    {
      locale: string;
      url: string;
    }[]
  > {
    return this.apps.listAccountDeletionUrls(appInfoId, listQuery);
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

  async resolveTeamId(listQuery: AppleListQuery | null = null): Promise<string | null> {
    return this.apps.resolveTeamId(listQuery);
  }

  async listAppNames(listQuery: AppleListQuery | null = null): Promise<string[]> {
    return this.apps.listAppNames(listQuery);
  }

  async listApps(
    listQuery: AppleListQuery | null = null,
  ): Promise<{ id: string; name: string; bundleId: string | null }[]> {
    return this.apps.listApps(listQuery);
  }

  async getAppInfo(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppInfoResource | null> {
    return this.apps.getAppInfo(appId, listQuery);
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

  async getLatestBuildNumber(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<number> {
    return this.builds.getLatestBuildNumber(bundleId, listQuery);
  }

  async getLatestMarketingVersion(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    return this.builds.getLatestMarketingVersion(bundleId, listQuery);
  }

  async getBuildProcessingState(
    bundleId: string,
    buildNumber: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    return this.builds.getBuildProcessingState(bundleId, buildNumber, listQuery);
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

  async getBuildUploadStatus(
    buildUploadId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildUploadStatus> {
    return this.builds.getBuildUploadStatus(buildUploadId, listQuery);
  }

  async findBuild(
    bundleId: string,
    buildNumber: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null> {
    return this.builds.findBuild(bundleId, buildNumber, listQuery);
  }

  async setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void> {
    return this.builds.setBuildUsesNonExemptEncryption(buildId, fieldValue);
  }

  async listEncryptionDeclarations(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<EncryptionDeclarationResource[]> {
    return this.builds.listEncryptionDeclarations(bundleId, listQuery);
  }

  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    return this.builds.linkBuildToDeclaration(declarationId, buildId);
  }

  async listBuilds(
    appId: string,
    limit = 25,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildResource[]> {
    return this.builds.listBuilds(appId, limit, listQuery);
  }

  async findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildResource | null> {
    return this.builds.findBuildByVersion(appId, buildNumber, marketingVersion, listQuery);
  }

  async getEditableVersionId(appId: string): Promise<string | null> {
    return this.versions.getEditableVersionId(appId);
  }

  async getCurrentVersionId(appId: string): Promise<string | null> {
    return this.versions.getCurrentVersionId(appId);
  }

  async listVersionStates(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ResourceList<VersionStates>['data']> {
    return this.versions.listVersionStates(appId, listQuery);
  }

  async listVersionLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    return this.versions.listVersionLocalizations(versionId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> {
    return this.versions.findEditableAppStoreVersion(appId, platform, listQuery);
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

  async listAppStoreVersions(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionResource[]> {
    return this.versions.listAppStoreVersions(appId, platform, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    return this.versions.listAppStoreVersionLocalizations(versionId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource[]> {
    return this.versions.listReviewSubmissions(appId, platform, listQuery);
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

  async getReviewSubmission(
    submissionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource> {
    return this.versions.getReviewSubmission(submissionId, listQuery);
  }

  async listAppClips(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipResource[]> {
    return this.appClips.listAppClips(appId, listQuery);
  }

  async listAppClipDefaultExperiences(
    appClipId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipDefaultExperienceResource[]> {
    return this.appClips.listAppClipDefaultExperiences(appClipId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipLocalizationResource[]> {
    return this.appClips.listAppClipDefaultExperienceLocalizations(experienceId, listQuery);
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

  async findBundleId(
    identifier: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdResource | null> {
    return this.signing.findBundleId(identifier, listQuery);
  }

  async createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> {
    return this.signing.createBundleId(identifier, name, bundleIdPlatform);
  }

  async listDistributionCertificates(
    listQuery: AppleListQuery | null = null,
  ): Promise<CertificateResource[]> {
    return this.signing.listDistributionCertificates(listQuery);
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

  async listDevices(listQuery: AppleListQuery | null = null): Promise<DeviceResource[]> {
    return this.signing.listDevices(listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdCapabilityResource[]> {
    return this.signing.listBundleIdCapabilities(bundleIdResourceId, listQuery);
  }

  async listProfilesForBundleId(
    bundleIdResourceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ProfileResource[]> {
    return this.signing.listProfilesForBundleId(bundleIdResourceId, listQuery);
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

  async listSandboxTesters(
    listQuery: AppleListQuery | null = null,
  ): Promise<SandboxTesterResource[]> {
    return this.sandbox.listSandboxTesters(listQuery);
  }

  async clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void> {
    return this.sandbox.clearSandboxTesterPurchaseHistory(testerIds);
  }

  async listInAppPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<InAppPurchaseResource[]> {
    return this.purchases.listInAppPurchases(appId, listQuery);
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

  async listSubscriptionGroups(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionGroupResource[]> {
    return this.purchases.listSubscriptionGroups(appId, listQuery);
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

  async listSubscriptions(
    groupId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionResource[]> {
    return this.purchases.listSubscriptions(groupId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    return this.purchases.findSubscriptionPricePoint(
      subscriptionId,
      territory,
      customerPrice,
      listQuery,
    );
  }

  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    return this.purchases.createSubscriptionPrice(subscriptionId, pricePointId);
  }

  async listSubscriptionOfferCodes(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<OfferCodeResource[]> {
    return this.purchases.listSubscriptionOfferCodes(subscriptionId, listQuery);
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

  async listPromotionalOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotionalOfferResource[]> {
    return this.purchases.listPromotionalOffers(subscriptionId, listQuery);
  }

  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    return this.purchases.createPromotionalOffer(input);
  }

  async listIntroductoryOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<IntroductoryOfferResource[]> {
    return this.purchases.listIntroductoryOffers(subscriptionId, listQuery);
  }

  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    return this.purchases.createIntroductoryOffer(input);
  }

  async listWinBackOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<WinBackOfferResource[]> {
    return this.purchases.listWinBackOffers(subscriptionId, listQuery);
  }

  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    return this.purchases.createWinBackOffer(input);
  }

  async listPromotedPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotedPurchaseResource[]> {
    return this.purchases.listPromotedPurchases(appId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    return this.purchases.findInAppPurchasePricePoint(iapId, territory, customerPrice, listQuery);
  }

  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    return this.purchases.createInAppPurchasePriceSchedule(iapId, baseTerritory, pricePointId);
  }

  async listBetaGroups(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaGroupResource[]> {
    return this.testflight.listBetaGroups(appId, listQuery);
  }

  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    return this.testflight.findBetaGroupByName(appId, name);
  }

  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    return this.testflight.createBetaGroup(appId, name);
  }

  async listBetaTestersInGroup(
    groupId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaTesterResource[]> {
    return this.testflight.listBetaTestersInGroup(groupId, listQuery);
  }

  async findBetaTesterByEmail(
    email: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaTesterResource | null> {
    return this.testflight.findBetaTesterByEmail(email, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    return this.testflight.listBetaFeedbackCrashSubmissions(appId, query, listQuery);
  }

  async listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
    return this.testflight.listBetaFeedbackScreenshotSubmissions(appId, query, listQuery);
  }

  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    return this.testflight.downloadBetaFeedbackScreenshot(url);
  }

  async listBetaBuildLocalizations(
    buildId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaBuildLocalizationResource[]> {
    return this.testflight.listBetaBuildLocalizations(buildId, listQuery);
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

  async listAccessibilityDeclarations(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AccessibilityDeclarationResource[]> {
    return this.accessibility.listAccessibilityDeclarations(appId, listQuery);
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

  async getAppAvailability(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppAvailabilityResource | null> {
    return this.availability.getAppAvailability(appId, listQuery);
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

  async listCustomProductPages(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageResource[]> {
    return this.customProductPages.listCustomProductPages(appId, listQuery);
  }

  async createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource> {
    return this.customProductPages.createCustomProductPage(appId, name);
  }

  async listCustomProductPageVersions(
    pageId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageVersionResource[]> {
    return this.customProductPages.listCustomProductPageVersions(pageId, listQuery);
  }

  async listCustomProductPageLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageLocalizationResource[]> {
    return this.customProductPages.listCustomProductPageLocalizations(versionId, listQuery);
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

  async listVersionExperiments(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<VersionExperimentResource[]> {
    return this.experiments.listVersionExperiments(appId, listQuery);
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

  async listExperimentTreatments(
    experimentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentResource[]> {
    return this.experiments.listExperimentTreatments(experimentId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentLocalizationResource[]> {
    return this.experiments.listExperimentTreatmentLocalizations(treatmentId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    return this.pricing.findAppPricePoint(appId, territory, customerPrice, listQuery);
  }

  async getCurrentAppPrice(
    appId: string,
    territory: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    return this.pricing.getCurrentAppPrice(appId, territory, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomerReviewResource[]> {
    return this.reviews.listCustomerReviews(appId, filters, listQuery);
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

  async listUsers(listQuery: AppleListQuery | null = null): Promise<UserResource[]> {
    return this.team.listUsers(listQuery);
  }

  async listUserInvitations(
    listQuery: AppleListQuery | null = null,
  ): Promise<UserInvitationResource[]> {
    return this.team.listUserInvitations(listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportRequestResource[]> {
    return this.reports.listAnalyticsReportRequests(appId, accessType, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportResource[]> {
    return this.reports.listAnalyticsReports(requestId, filters, listQuery);
  }

  async listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    } = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportInstanceResource[]> {
    return this.reports.listAnalyticsReportInstances(reportId, filters, listQuery);
  }

  async listAnalyticsReportSegments(
    instanceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportSegmentResource[]> {
    return this.reports.listAnalyticsReportSegments(instanceId, listQuery);
  }

  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    return this.reports.downloadAnalyticsSegment(url);
  }

  async listAppEvents(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppEventResource[]> {
    return this.events.listAppEvents(appId, listQuery);
  }

  async listAppEventLocalizations(
    eventId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppEventLocalizationResource[]> {
    return this.events.listAppEventLocalizations(eventId, listQuery);
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

  async listScreenshotSets(
    versionLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotSetResource[]> {
    return this.screenshots.listScreenshotSets(versionLocalizationId, listQuery);
  }

  async createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.screenshots.createScreenshotSet(versionLocalizationId, displayType);
  }

  async listTreatmentScreenshotSets(
    treatmentLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotSetResource[]> {
    return this.screenshots.listTreatmentScreenshotSets(treatmentLocalizationId, listQuery);
  }

  async createTreatmentScreenshotSet(
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    return this.screenshots.createTreatmentScreenshotSet(treatmentLocalizationId, displayType);
  }

  async listScreenshots(
    setId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotResource[]> {
    return this.screenshots.listScreenshots(setId, listQuery);
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
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewScreenshotResource | null> {
    return this.screenshots.getSubscriptionReviewScreenshot(subscriptionId, listQuery);
  }

  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> {
    return this.screenshots.uploadSubscriptionReviewScreenshot(subscriptionId, fileName, filePath);
  }

  async listPreviewSets(
    versionLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PreviewSetResource[]> {
    return this.screenshots.listPreviewSets(versionLocalizationId, listQuery);
  }

  async createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> {
    return this.screenshots.createPreviewSet(versionLocalizationId, previewType);
  }

  async listPreviews(
    setId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PreviewResource[]> {
    return this.screenshots.listPreviews(setId, listQuery);
  }

  async uploadPreview(setId: string, fileName: string, filePath: string): Promise<void> {
    return this.screenshots.uploadPreview(setId, fileName, filePath);
  }

  async listAlternativeDistributionDomains(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionDomainResource[]> {
    return this.distribution.listAlternativeDistributionDomains(listQuery);
  }

  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    return this.distribution.createAlternativeDistributionDomain(domain, referenceName);
  }

  async listAlternativeDistributionKeys(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionKeyResource[]> {
    return this.distribution.listAlternativeDistributionKeys(listQuery);
  }

  async createAlternativeDistributionKey(publicKey: string): Promise<{
    id: string;
  }> {
    return this.distribution.createAlternativeDistributionKey(publicKey);
  }

  async listMerchantIds(listQuery: AppleListQuery | null = null): Promise<MerchantIdResource[]> {
    return this.distribution.listMerchantIds(listQuery);
  }

  async createMerchantId(identifier: string, name: string): Promise<void> {
    return this.distribution.createMerchantId(identifier, name);
  }

  async listPassTypeIds(listQuery: AppleListQuery | null = null): Promise<PassTypeIdResource[]> {
    return this.distribution.listPassTypeIds(listQuery);
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

  async listGameCenterAchievements(
    detailId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<GameCenterAchievementResource[]> {
    return this.gameCenter.listGameCenterAchievements(detailId, listQuery);
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

  async listGameCenterLeaderboards(
    detailId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<GameCenterLeaderboardResource[]> {
    return this.gameCenter.listGameCenterLeaderboards(detailId, listQuery);
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
