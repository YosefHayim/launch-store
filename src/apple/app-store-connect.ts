// Calls the App Store Connect endpoints Launch commands use.

import type { components } from '../apple-api-types.ts';
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
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
  CustomerReviewResource,
  CustomerReviewResponseResource,
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
import {
  AD_HOC_PROFILE_TYPE,
  APP_STORE_PROFILE_TYPE,
  type LocaleCopy,
  type ProvisioningProfileType,
} from './shared.ts';
import type { AscKey } from '../types/credentials.ts';
import { AppStoreConnectClient } from './app-store-connect-client.ts';
import { AppStoreToken, signAppStoreConnectToken } from './app-store-token.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

type AppList = components['schemas']['AppsResponse'];

type BuildUploadResponse = components['schemas']['BuildUploadResponse'];

type BuildUploadCreateRequest = components['schemas']['BuildUploadCreateRequest'];

interface AppleResource {
  id?: string;
  attributes?: {
    name?: string;
    productId?: string;
    versionString?: string;
    bundleId?: string;
  };
}

interface ApplePage {
  data?: readonly AppleResource[];
}

interface BuildUploadRequest {
  appId: string;
  version: string;
  buildNumber: number;
  platform: components['schemas']['Platform'];
}

export class AppStoreConnect {
  private storeClient: AppStoreConnectClient | null = null;

  constructor(
    private readonly accountKey: AscKey | null = null,
    private readonly token = new AppStoreToken(),
  ) {}

  /**
   * Lists the apps this key can see.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps
   */
  async listApps(listQuery: AppleListQuery | null = null): Promise<AppList> {
    const path = applyAppleListQuery('/v1/apps', listQuery, APPLE_PAGE_LIMIT);
    const page = await this.send('GET', path, null);

    return page as AppList;
  }

  /**
   * Opens a build upload for one version of an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploads}
   */
  async createBuildUpload(buildUpload: BuildUploadRequest): Promise<string> {
    const requestDocument: BuildUploadCreateRequest = {
      data: {
        type: 'buildUploads',
        attributes: {
          cfBundleShortVersionString: buildUpload.version,
          cfBundleVersion: String(buildUpload.buildNumber),
          platform: buildUpload.platform,
        },
        relationships: {
          app: { data: { type: 'apps', id: buildUpload.appId } },
        },
      },
    };
    const created = (await this.send(
      'POST',
      '/v1/buildUploads',
      requestDocument,
    )) as BuildUploadResponse;
    const uploadId = created.data.id;

    const isMissing = uploadId == null;

    if (isMissing) {
      throw new Error('App Store Connect did not return a build upload id');
    }

    return uploadId;
  }

  /**
   * Uploads a build file to a build upload.
   *
   * Launch reserves the file, sends the bytes, then marks the file uploaded.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-builduploadfiles}
   */
  async uploadBuildFile(
    buildUploadId: string,
    fileName: string,
    binaryPath: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.uploadBuildFile(buildUploadId, fileName, binaryPath);
  }

  /**
   * Reads whether a build upload has finished.
   *
   * Launch also reads the uploaded file's delivery state.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builduploads-_id_}
   */
  async getBuildUploadStatus(
    buildUploadId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildUploadStatus> {
    const connectClient = await this.openClient();

    return connectClient.getBuildUploadStatus(buildUploadId, listQuery);
  }

  /**
   * Lists App Store versions for one app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   */
  async listVersions(appId: string): Promise<readonly string[]> {
    const page = await this.readPage(`/v1/apps/${appId}/appStoreVersions`);

    return namesFrom(page, 'versionString');
  }

  /**
   * Lists the app info records that hold the privacy details.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos
   */
  async listAppInfo(appId: string): Promise<readonly string[]> {
    const page = await this.readPage(`/v1/apps/${appId}/appInfos`);

    return namesFrom(page, 'name');
  }

  async findAppId(bundleId: string): Promise<string | null> {
    const apps = await this.listApps();

    function isThisApp(app: AppList['data'][number]): boolean {
      return app.attributes?.bundleId == bundleId;
    }

    const app = apps.data.find(isThisApp);

    const isMissing = app == null;

    if (isMissing) {
      return null;
    }

    return app.id;
  }

  /**
   * Finds the App Store Connect app id for a bundle id.
   *
   * Launch asks for one app with that bundle id.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps}
   */
  async getAppId(bundleId: string): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getAppId(bundleId);
  }

  /**
   * Reads the app info id that can still be edited.
   *
   * Launch keeps the app info that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos}
   */
  async getEditableAppInfoId(appId: string): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getEditableAppInfoId(appId);
  }

  /**
   * Reads the app info id that can still be edited, or the live one.
   *
   * Launch uses the app info that can still be edited, and the live app info when none can be
   * edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos}
   */
  async getCurrentAppInfoId(appId: string): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getCurrentAppInfoId(appId);
  }

  /**
   * Get a list of localized, app-level information for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations}
   */
  async listAppInfoLocalizations(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppInfoLocalizations(appInfoId, listQuery);
  }

  /**
   * Get a list of localized, app-level information for an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations}
   */
  async listAccountDeletionUrls(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<
    {
      locale: string;
      url: string;
    }[]
  > {
    const connectClient = await this.openClient();

    return connectClient.listAccountDeletionUrls(appInfoId, listQuery);
  }

  /**
   * Add app-level localized information for a new locale.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appinfolocalizations}
   */
  async createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAppInfoLocalization(appInfoId, locale, fields);
  }

  /**
   * Modify localized app-level information for a particular language.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfolocalizations-_id_}
   */
  async updateAppInfoLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppInfoLocalization(localizationId, fields);
  }

  /**
   * Checks that this App Store Connect key can call the API.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids}
   */
  async assertReady(): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.assertReady();
  }

  /**
   * Checks that the Paid and Free Apps agreements are active.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids}
   */
  async checkRequiredAgreements(): Promise<boolean> {
    const connectClient = await this.openClient();

    return connectClient.checkRequiredAgreements();
  }

  /**
   * Reads the Apple team id for this App Store Connect key.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids}
   */
  async resolveTeamId(listQuery: AppleListQuery | null = null): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.resolveTeamId(listQuery);
  }

  /**
   * Lists the names of the apps this key can see.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps}
   */
  async listAppNames(listQuery: AppleListQuery | null = null): Promise<string[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppNames(listQuery);
  }

  /**
   * Get information about an app that is currently live on App Store, or that goes live with the
   * next version.
   *
   * Launch asks for at most 200 records on a page. Launch uses the app info that can still be
   * edited, and the first app info when none can be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos}
   */
  async getAppInfo(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppInfoResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getAppInfo(appId, listQuery);
  }

  /**
   * Update the App Store categories and sub-categories for your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfos-_id_}
   */
  async updateAppInfoCategories(
    appInfoId: string,
    categories: {
      primaryCategoryId?: string;
      secondaryCategoryId?: string | null;
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppInfoCategories(appInfoId, categories);
  }

  /**
   * Get the age-rating declaration for an app info.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-ageratingdeclaration}
   */
  async getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getAgeRatingDeclaration(appInfoId);
  }

  /**
   * Provide age-related information so the App Store can determine the age rating for your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-ageratingdeclarations-_id_}
   */
  async updateAgeRatingDeclaration(
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAgeRatingDeclaration(declarationId, attributes);
  }

  /**
   * Reads the highest build number Apple has for a bundle id.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async getLatestBuildNumber(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<number> {
    const connectClient = await this.openClient();

    return connectClient.getLatestBuildNumber(bundleId, listQuery);
  }

  /**
   * Reads the newest marketing version Apple has for a bundle id.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async getLatestMarketingVersion(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getLatestMarketingVersion(bundleId, listQuery);
  }

  /**
   * Reads whether Apple is still processing a build.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async getBuildProcessingState(
    bundleId: string,
    buildNumber: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getBuildProcessingState(bundleId, buildNumber, listQuery);
  }

  /**
   * Finds a build by its build number.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async findBuild(
    bundleId: string,
    buildNumber: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null> {
    const connectClient = await this.openClient();

    return connectClient.findBuild(bundleId, buildNumber, listQuery);
  }

  /**
   * Sets whether a build uses non-exempt encryption.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-builds-_id_}
   */
  async setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.setBuildUsesNonExemptEncryption(buildId, fieldValue);
  }

  /**
   * Lists the encryption declarations for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appencryptiondeclarations}
   */
  async listEncryptionDeclarations(
    bundleId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<EncryptionDeclarationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listEncryptionDeclarations(bundleId, listQuery);
  }

  /**
   * Links a build to an encryption declaration.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appencryptiondeclarations-_id_-relationships-builds}
   */
  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.linkBuildToDeclaration(declarationId, buildId);
  }

  /**
   * Lists the builds Apple has for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async listBuilds(
    appId: string,
    limit = 25,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBuilds(appId, limit, listQuery);
  }

  /**
   * Finds a build by its build number.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds}
   */
  async findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BuildResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findBuildByVersion(appId, buildNumber, marketingVersion, listQuery);
  }

  /**
   * Reads the version id that can still be edited.
   *
   * Launch keeps the version that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async getEditableVersionId(appId: string): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getEditableVersionId(appId);
  }

  /**
   * Reads the version id that can still be edited, or the live one.
   *
   * Launch uses the version that can still be edited, and the live version when none can be
   * edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async getCurrentVersionId(appId: string): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getCurrentVersionId(appId);
  }

  /**
   * Get a list of localized, version-level information about an app, for all locales.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations}
   */
  async listVersionLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    const connectClient = await this.openClient();

    return connectClient.listVersionLocalizations(versionId, listQuery);
  }

  /**
   * Add localized version-level information for a new locale.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations}
   */
  async createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createVersionLocalization(versionId, locale, fields);
  }

  /**
   * Modify localized version-level information for a particular language.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_}
   */
  async updateVersionLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateVersionLocalization(localizationId, fields);
  }

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * Launch returns the version that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async findEditableAppStoreVersion(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> {
    const connectClient = await this.openClient();

    return connectClient.findEditableAppStoreVersion(appId, platform, listQuery);
  }

  /**
   * Get the details you provide to App Review so they can test your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstorereviewdetail}
   */
  async getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getAppStoreReviewDetail(versionId);
  }

  /**
   * Add App Store review details to an App Store version, including contact and demo account
   * information.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstorereviewdetails}
   */
  async createAppStoreReviewDetail(
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{
    id: string;
  }> {
    const connectClient = await this.openClient();

    return connectClient.createAppStoreReviewDetail(versionId, attributes);
  }

  /**
   * Update the App Store review details, including the contact information, demo account, and
   * notes.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstorereviewdetails-_id_}
   */
  async updateAppStoreReviewDetail(
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppStoreReviewDetail(detailId, attributes);
  }

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions}
   */
  async listAppStoreVersions(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppStoreVersions(appId, platform, listQuery);
  }

  /**
   * Add a new App Store version or platform to an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversions}
   */
  async createAppStoreVersion(
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource> {
    const connectClient = await this.openClient();

    return connectClient.createAppStoreVersion(appId, input);
  }

  /**
   * Update the App Store version for a specific app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_}
   */
  async updateAppStoreVersion(
    versionId: string,
    input: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppStoreVersion(versionId, input);
  }

  /**
   * Change the build that is attached to a specific App Store version.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_-relationships-build}
   */
  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.selectBuildForVersion(versionId, buildId);
  }

  /**
   * Get a list of localized, version-level information about an app, for all locales.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations}
   */
  async listAppStoreVersionLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppStoreVersionLocalizations(versionId, listQuery);
  }

  /**
   * Add localized version-level information for a new locale.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations}
   */
  async createAppStoreVersionLocalization(
    versionId: string,
    input: {
      locale: string;
      whatsNew: string;
    },
  ): Promise<AppStoreVersionLocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createAppStoreVersionLocalization(versionId, input);
  }

  /**
   * Modify localized version-level information for a particular language.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_}
   */
  async updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppStoreVersionLocalization(localizationId, whatsNew);
  }

  /**
   * Read the phased release status and configuration for a version with phased release enabled.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionphasedrelease}
   */
  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getPhasedRelease(versionId);
  }

  /**
   * Enable phased release for an App Store version.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionphasedreleases}
   */
  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const connectClient = await this.openClient();

    return connectClient.createPhasedRelease(versionId);
  }

  /**
   * Pause or resume a phased release, or immediately release an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionphasedreleases-_id_}
   */
  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updatePhasedRelease(phasedReleaseId, phasedReleaseState);
  }

  /**
   * Cancel a planned phased release that has not been started.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionphasedreleases-_id_}
   */
  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deletePhasedRelease(phasedReleaseId);
  }

  /**
   * Get a list of review submissions associated with a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-reviewsubmissions}
   */
  async listReviewSubmissions(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listReviewSubmissions(appId, platform, listQuery);
  }

  /**
   * Create a review submission for a specific app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions}
   */
  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    const connectClient = await this.openClient();

    return connectClient.createReviewSubmission(appId, platform);
  }

  /**
   * Create a new review submission item.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems}
   */
  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.addReviewSubmissionItem(submissionId, versionId);
  }

  /**
   * Create a new review submission item.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems}
   */
  async addExperimentReviewSubmissionItem(
    submissionId: string,
    experimentId: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.addExperimentReviewSubmissionItem(submissionId, experimentId);
  }

  /**
   * Edit the details or contents of a review submission.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_}
   */
  async submitReviewSubmission(submissionId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.submitReviewSubmission(submissionId);
  }

  /**
   * Reads the state of one review submission.
   *
   * Launch keeps the submission id and its state.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_}
   */
  async getReviewSubmission(
    submissionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource> {
    const connectClient = await this.openClient();

    return connectClient.getReviewSubmission(submissionId, listQuery);
  }

  /**
   * Release an approved version of your app to the App Store.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionreleaserequests}
   */
  async createAppStoreVersionReleaseRequest(versionId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAppStoreVersionReleaseRequest(versionId);
  }

  /**
   * List your app’s associated App Clips.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appclips}
   */
  async listAppClips(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppClips(appId, listQuery);
  }

  /**
   * Lists the default App Clip experiences for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclips-_id_-appclipdefaultexperiences}
   */
  async listAppClipDefaultExperiences(
    appClipId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipDefaultExperienceResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppClipDefaultExperiences(appClipId, listQuery);
  }

  /**
   * Configure a new default App Clip experience.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiences}
   */
  async createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{
    id: string;
  }> {
    const connectClient = await this.openClient();

    return connectClient.createAppClipDefaultExperience(appClipId, versionId, action);
  }

  /**
   * Update a default App Clip experience.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiences-_id_}
   */
  async updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppClipDefaultExperienceAction(experienceId, action);
  }

  /**
   * Get localized metadata that appears on the App Clip card for a specific default App Clip
   * experience.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-appclipdefaultexperiencelocalizations}
   */
  async listAppClipDefaultExperienceLocalizations(
    experienceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppClipDefaultExperienceLocalizations(experienceId, listQuery);
  }

  /**
   * Provide localized metadata that appears on the App Clip card of a default App Clip experience.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiencelocalizations}
   */
  async createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAppClipDefaultExperienceLocalization(experienceId, locale, subtitle);
  }

  /**
   * Update localized metadata for a specific default App Clip experience.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiencelocalizations-_id_}
   */
  async updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppClipDefaultExperienceLocalization(localizationId, subtitle);
  }

  /**
   * Finds the bundle id record for an identifier.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids}
   */
  async findBundleId(
    identifier: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findBundleId(identifier, listQuery);
  }

  /**
   * Register a new bundle ID for app development.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids}
   */
  async createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> {
    const connectClient = await this.openClient();

    return connectClient.createBundleId(identifier, name, bundleIdPlatform);
  }

  /**
   * Lists the distribution certificates on this team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-certificates}
   */
  async listDistributionCertificates(
    listQuery: AppleListQuery | null = null,
  ): Promise<CertificateResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listDistributionCertificates(listQuery);
  }

  /**
   * Create a new certificate using a certificate signing request.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-certificates}
   */
  async createCertificate(csrContent: string): Promise<CertificateResource> {
    const connectClient = await this.openClient();

    return connectClient.createCertificate(csrContent);
  }

  /**
   * Finds a provisioning profile by its name.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-profiles}
   */
  async findProfileByName(name: string): Promise<ProfileResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findProfileByName(name);
  }

  /**
   * Create a new provisioning profile.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles}
   */
  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: ProvisioningProfileType = APP_STORE_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    const connectClient = await this.openClient();

    return connectClient.createAppStoreProfile(
      name,
      bundleIdResourceId,
      certificateId,
      profileType,
    );
  }

  /**
   * Delete a provisioning profile that is used for app development or distribution.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-profiles-_id_}
   */
  async deleteProfile(id: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deleteProfile(id);
  }

  /**
   * Lists the devices registered on this team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-devices}
   */
  async listDevices(listQuery: AppleListQuery | null = null): Promise<DeviceResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listDevices(listQuery);
  }

  /**
   * Register a new device for app development.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-devices}
   */
  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    const connectClient = await this.openClient();

    return connectClient.registerDevice(udid, name);
  }

  /**
   * Create a new provisioning profile.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles}
   */
  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    const connectClient = await this.openClient();

    return connectClient.createAdHocProfile(
      name,
      bundleIdResourceId,
      certificateId,
      deviceIds,
      profileType,
    );
  }

  /**
   * Get a list of all capabilities for a specific bundle ID.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-bundleidcapabilities}
   */
  async listBundleIdCapabilities(
    bundleIdResourceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BundleIdCapabilityResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBundleIdCapabilities(bundleIdResourceId, listQuery);
  }

  /**
   * Get a list of all profiles for a specific bundle ID.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-profiles}
   */
  async listProfilesForBundleId(
    bundleIdResourceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ProfileResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listProfilesForBundleId(bundleIdResourceId, listQuery);
  }

  /**
   * Enable a capability for a bundle ID.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleidcapabilities}
   */
  async enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource> {
    const connectClient = await this.openClient();

    return connectClient.enableCapability(bundleIdResourceId, capabilityType);
  }

  /**
   * Disable a capability for a bundle ID.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-bundleidcapabilities-_id_}
   */
  async disableCapability(capabilityId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.disableCapability(capabilityId);
  }

  /**
   * Get a list of Sandbox Testers for your team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-sandboxtesters}
   */
  async listSandboxTesters(
    listQuery: AppleListQuery | null = null,
  ): Promise<SandboxTesterResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSandboxTesters(listQuery);
  }

  /**
   * Remove purchase history from a Sandbox Apple Account.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-sandboxtestersclearpurchasehistoryrequest}
   */
  async clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.clearSandboxTesterPurchaseHistory(testerIds);
  }

  /**
   * Get a list of the In-App Purchases for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2}
   */
  async listInAppPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<InAppPurchaseResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listInAppPurchases(appId, listQuery);
  }

  /**
   * Create an In-App Purchase, including a consumable, non-consumable, or non-renewing
   * subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchases}
   */
  async createInAppPurchase(
    appId: string,
    input: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Promise<InAppPurchaseResource> {
    const connectClient = await this.openClient();

    return connectClient.createInAppPurchase(appId, input);
  }

  /**
   * Lists the localized names for an in-app purchase.
   *
   * Launch reads the draft version when one can still be edited, and the newest version otherwise.
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-inapppurchaseversions-_id_-localizations}
   */
  async listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listInAppPurchaseLocalizations(iapId);
  }

  /**
   * Creates a localized name for an in-app purchase.
   *
   * Launch writes the localization onto the version that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchaselocalizations}
   */
  async createInAppPurchaseLocalization(
    iapId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createInAppPurchaseLocalization(iapId, copy);
  }

  /**
   * Get a list of subscription groups for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-subscriptiongroups}
   */
  async listSubscriptionGroups(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionGroupResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSubscriptionGroups(appId, listQuery);
  }

  /**
   * Create a subscription group for an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptiongroups}
   */
  async createSubscriptionGroup(
    appId: string,
    referenceName: string,
  ): Promise<SubscriptionGroupResource> {
    const connectClient = await this.openClient();

    return connectClient.createSubscriptionGroup(appId, referenceName);
  }

  /**
   * Lists the localized names for a subscription group.
   *
   * Launch reads the draft version when one can still be edited, and the newest version otherwise.
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroupversions-_id_-localizations}
   */
  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSubscriptionGroupLocalizations(groupId);
  }

  /**
   * Creates a localized name for a subscription group.
   *
   * Launch writes the localization onto the version that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-subscriptiongrouplocalizations}
   */
  async createSubscriptionGroupLocalization(
    groupId: string,
    copy: Omit<LocaleCopy, 'description'>,
  ): Promise<LocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createSubscriptionGroupLocalization(groupId, copy);
  }

  /**
   * Get a list of all auto-renewable subscriptions in a subscription group.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptiongroups-_id_-subscriptions}
   */
  async listSubscriptions(
    groupId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<SubscriptionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSubscriptions(groupId, listQuery);
  }

  /**
   * Create an auto-renewable subscription for your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptions}
   */
  async createSubscription(
    groupId: string,
    input: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Promise<SubscriptionResource> {
    const connectClient = await this.openClient();

    return connectClient.createSubscription(groupId, input);
  }

  /**
   * Lists the localized names for a subscription.
   *
   * Launch reads the draft version when one can still be edited, and the newest version otherwise.
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptionversions-_id_-localizations}
   */
  async listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSubscriptionLocalizations(subscriptionId);
  }

  /**
   * Creates a localized name for a subscription.
   *
   * Launch writes the localization onto the version that can still be edited.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-subscriptionlocalizations}
   */
  async createSubscriptionLocalization(
    subscriptionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createSubscriptionLocalization(subscriptionId, copy);
  }

  /**
   * Get a list of prices for an auto-renewable subscription, by territory.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-prices}
   */
  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const connectClient = await this.openClient();

    return connectClient.subscriptionHasPrice(subscriptionId);
  }

  /**
   * Get a list of price points for an auto-renewable subscription by territory.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-pricepoints}
   */
  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findSubscriptionPricePoint(
      subscriptionId,
      territory,
      customerPrice,
      listQuery,
    );
  }

  /**
   * Schedule a subscription price change for a specific territory.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionprices}
   */
  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createSubscriptionPrice(subscriptionId, pricePointId);
  }

  /**
   * Get a list of subscription offer codes for a specific auto-renewable subscription.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-offercodes}
   */
  async listSubscriptionOfferCodes(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<OfferCodeResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listSubscriptionOfferCodes(subscriptionId, listQuery);
  }

  /**
   * Create a subscription offer that provides offer codes for an auto-renewable subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodes}
   */
  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    const connectClient = await this.openClient();

    return connectClient.createSubscriptionOfferCode(input);
  }

  /**
   * Deactivate a subscription offer that has offer codes for an auto-renewable subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-subscriptionoffercodes-_id_}
   */
  async deactivateOfferCode(offerCodeId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deactivateOfferCode(offerCodeId);
  }

  /**
   * Create one-time use codes for an auto-renewable subscription offer.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodeonetimeusecodes}
   */
  async createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createOfferCodeOneTimeUseBatch(offerCodeId, numberOfCodes, expirationDate);
  }

  /**
   * Create custom offer codes for an auto-renewable subscription offer.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionoffercodecustomcodes}
   */
  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createOfferCodeCustomCode(
      offerCodeId,
      customCode,
      numberOfCodes,
      expirationDate,
    );
  }

  /**
   * Get a list of promotional offers for a specific auto-renewable subscription.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-promotionaloffers}
   */
  async listPromotionalOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotionalOfferResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listPromotionalOffers(subscriptionId, listQuery);
  }

  /**
   * Create a promotional offer for an auto-renewable subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionpromotionaloffers}
   */
  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    const connectClient = await this.openClient();

    return connectClient.createPromotionalOffer(input);
  }

  /**
   * Get a list of introductory offers for a specific auto-renewable subscription.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-introductoryoffers}
   */
  async listIntroductoryOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<IntroductoryOfferResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listIntroductoryOffers(subscriptionId, listQuery);
  }

  /**
   * Create an introductory offer for an auto-renewable subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionintroductoryoffers}
   */
  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createIntroductoryOffer(input);
  }

  /**
   * List Win-Back Offers.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-winbackoffers}
   */
  async listWinBackOffers(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<WinBackOfferResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listWinBackOffers(subscriptionId, listQuery);
  }

  /**
   * Create a win-back offer for a specific subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-winbackoffers}
   */
  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createWinBackOffer(input);
  }

  /**
   * Get a list of promoted In-App Purchases, including promoted auto-renewable subscriptions, for
   * an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-promotedpurchases}
   */
  async listPromotedPurchases(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PromotedPurchaseResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listPromotedPurchases(appId, listQuery);
  }

  /**
   * Add an existing In-App Purchase or auto-renewable subscription to the promoted In-App
   * Purchases on an app listing in the App Store.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-promotedpurchases}
   */
  async createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    const connectClient = await this.openClient();

    return connectClient.createPromotedPurchase(input);
  }

  /**
   * Update the order of promoted purchases.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_-relationships-promotedpurchases}
   */
  async reorderPromotedPurchases(appId: string, orderedIds: readonly string[]): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.reorderPromotedPurchases(appId, orderedIds);
  }

  /**
   * Get a list of the scheduled prices for an In-App Purchase.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-iappriceschedule}
   */
  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    const connectClient = await this.openClient();

    return connectClient.inAppPurchaseHasPrice(iapId);
  }

  /**
   * Get a list of possible price points for an In-App Purchase.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints}
   */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findInAppPurchasePricePoint(iapId, territory, customerPrice, listQuery);
  }

  /**
   * Create a scheduled price change for an In-App Purchase.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchasepriceschedules}
   */
  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createInAppPurchasePriceSchedule(iapId, baseTerritory, pricePointId);
  }

  /**
   * Get a list of beta groups associated with a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betagroups}
   */
  async listBetaGroups(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaGroupResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBetaGroups(appId, listQuery);
  }

  /**
   * Finds a TestFlight group by its name.
   *
   * Launch keeps the group whose name matches.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betagroups}
   */
  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findBetaGroupByName(appId, name);
  }

  /**
   * Create a beta group associated with an app, optionally enabling TestFlight public links.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups}
   */
  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    const connectClient = await this.openClient();

    return connectClient.createBetaGroup(appId, name);
  }

  /**
   * Lists the testers in a TestFlight group.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betagroups-_id_-betatesters}
   */
  async listBetaTestersInGroup(
    groupId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaTesterResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBetaTestersInGroup(groupId, listQuery);
  }

  /**
   * Finds a TestFlight tester by email.
   *
   * Launch asks for one tester with that email.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-betatesters}
   */
  async findBetaTesterByEmail(
    email: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaTesterResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findBetaTesterByEmail(email, listQuery);
  }

  /**
   * Create a beta tester assigned to a group, a build, or an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters}
   */
  async createBetaTester(
    groupId: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<BetaTesterResource> {
    const connectClient = await this.openClient();

    return connectClient.createBetaTester(groupId, input);
  }

  /**
   * Add a specific beta tester to one or more beta groups for beta testing.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-betatesters}
   */
  async addTestersToGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.addTestersToGroup(groupId, testerIds);
  }

  /**
   * Remove a specific beta tester from a one or more beta groups, revoking their access to test
   * builds associated with those groups.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-betagroups-_id_-relationships-betatesters}
   */
  async removeTestersFromGroup(groupId: string, testerIds: readonly string[]): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.removeTestersFromGroup(groupId, testerIds);
  }

  /**
   * Lists TestFlight crash feedback for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackcrashsubmissions}
   */
  async listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBetaFeedbackCrashSubmissions(appId, query, listQuery);
  }

  /**
   * Lists TestFlight screenshot feedback for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackscreenshotsubmissions}
   */
  async listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBetaFeedbackScreenshotSubmissions(appId, query, listQuery);
  }

  /**
   * Downloads one TestFlight feedback screenshot.
   *
   * Launch downloads the screenshot address Apple returned.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackscreenshotsubmissions}
   */
  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    const connectClient = await this.openClient();

    return connectClient.downloadBetaFeedbackScreenshot(url);
  }

  /**
   * Get a list of localized beta test information for a specific build.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betabuildlocalizations}
   */
  async listBetaBuildLocalizations(
    buildId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<BetaBuildLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listBetaBuildLocalizations(buildId, listQuery);
  }

  /**
   * Create localized What’s New text for a build.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betabuildlocalizations}
   */
  async createBetaBuildLocalization(
    buildId: string,
    locale: string,
    whatsNew: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createBetaBuildLocalization(buildId, locale, whatsNew);
  }

  /**
   * Update the localized What’s New text for a specific beta build and locale.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betabuildlocalizations-_id_}
   */
  async updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateBetaBuildLocalization(localizationId, whatsNew);
  }

  /**
   * Get the beta app review submission status for a specific build.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-betaappreviewsubmission}
   */
  async getBetaAppReviewSubmission(
    buildId: string,
  ): Promise<BetaAppReviewSubmissionResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getBetaAppReviewSubmission(buildId);
  }

  /**
   * Submit an app for beta app review to allow external testing.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappreviewsubmissions}
   */
  async createBetaAppReviewSubmission(buildId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createBetaAppReviewSubmission(buildId);
  }

  /**
   * Get a list of the accessibility declarations for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-accessibilitydeclarations}
   */
  async listAccessibilityDeclarations(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AccessibilityDeclarationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAccessibilityDeclarations(appId, listQuery);
  }

  /**
   * Add an accessibility declaration for a specific app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-accessibilitydeclarations}
   */
  async createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource> {
    const connectClient = await this.openClient();

    return connectClient.createAccessibilityDeclaration(appId, deviceFamily, support);
  }

  /**
   * Update the attributes of a specific accessibility declaration.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-accessibilitydeclarations-_id_}
   */
  async updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & {
      publish?: boolean;
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAccessibilityDeclaration(declarationId, changes);
  }

  /**
   * List Availability for an App.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appavailabilityv2}
   */
  async getAppAvailability(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppAvailabilityResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getAppAvailability(appId, listQuery);
  }

  /**
   * Create an app pre-order and set the expected app release date.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appavailabilities}
   */
  async createAppAvailability(
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAppAvailability(appId, input);
  }

  /**
   * Update the release territories for your app pre-order.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-territoryavailabilities-_id_}
   */
  async updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateAppAvailabilityTerritories(availabilityId, territories);
  }

  /**
   * Get a list of all custom product pages for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appcustomproductpages}
   */
  async listCustomProductPages(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listCustomProductPages(appId, listQuery);
  }

  /**
   * Add a custom product page for your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpages}
   */
  async createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource> {
    const connectClient = await this.openClient();

    return connectClient.createCustomProductPage(appId, name);
  }

  /**
   * List the versions for a custom product page version.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpages-_id_-appcustomproductpageversions}
   */
  async listCustomProductPageVersions(
    pageId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageVersionResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listCustomProductPageVersions(pageId, listQuery);
  }

  /**
   * List all localizations for an app custom product page.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpageversions-_id_-appcustomproductpagelocalizations}
   */
  async listCustomProductPageLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listCustomProductPageLocalizations(versionId, listQuery);
  }

  /**
   * Add a localization for your app custom product page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpagelocalizations}
   */
  async createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createCustomProductPageLocalization(versionId, locale, promotionalText);
  }

  /**
   * Update the promotional text for an app custom product page localization.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appcustomproductpagelocalizations-_id_}
   */
  async updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.updateCustomProductPageLocalization(localizationId, promotionalText);
  }

  /**
   * Get a list of all App Store version experiments for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversionexperimentsv2}
   */
  async listVersionExperiments(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<VersionExperimentResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listVersionExperiments(appId, listQuery);
  }

  /**
   * Add a new experiment to an App Store version.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appstoreversionexperiments}
   */
  async createVersionExperiment(
    appId: string,
    input: {
      name: string;
      platform: string;
      trafficProportion: number;
    },
  ): Promise<VersionExperimentResource> {
    const connectClient = await this.openClient();

    return connectClient.createVersionExperiment(appId, input);
  }

  /**
   * Get a list of all treatments for a specific App Store version experiment.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v2-appstoreversionexperiments-_id_-appstoreversionexperimenttreatments}
   */
  async listExperimentTreatments(
    experimentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listExperimentTreatments(experimentId, listQuery);
  }

  /**
   * Add a new treatment to an App Store version experiment.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatments}
   */
  async createExperimentTreatment(
    experimentId: string,
    input: {
      name: string;
      appIconName?: string;
    },
  ): Promise<ExperimentTreatmentResource> {
    const connectClient = await this.openClient();

    return connectClient.createExperimentTreatment(experimentId, input);
  }

  /**
   * Update the name, the started state, and the proportion of traffic to send to an App Store
   * experiment.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v2-appstoreversionexperiments-_id_}
   */
  async startVersionExperiment(experimentId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.startVersionExperiment(experimentId);
  }

  /**
   * Get a list of all localizations for a specific App Store version experiment treatment.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatments-_id_-appstoreversionexperimenttreatmentlocalizations}
   */
  async listExperimentTreatmentLocalizations(
    treatmentId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ExperimentTreatmentLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listExperimentTreatmentLocalizations(treatmentId, listQuery);
  }

  /**
   * Add a new localization for an App Store version experiment treatment.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionexperimenttreatmentlocalizations}
   */
  async createExperimentTreatmentLocalization(
    treatmentId: string,
    locale: string,
  ): Promise<ExperimentTreatmentLocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createExperimentTreatmentLocalization(treatmentId, locale);
  }

  /**
   * Get all the available price points for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apppricepoints}
   */
  async findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const connectClient = await this.openClient();

    return connectClient.findAppPricePoint(appId, territory, customerPrice, listQuery);
  }

  /**
   * Reads the price currently on sale for an app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apppriceschedule-manualprices}
   */
  async getCurrentAppPrice(
    appId: string,
    territory: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    const connectClient = await this.openClient();

    return connectClient.getCurrentAppPrice(appId, territory, listQuery);
  }

  /**
   * Create a scheduled price change for an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppriceschedules}
   */
  async createAppPriceSchedule(
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAppPriceSchedule(appId, baseTerritory, pricePointId);
  }

  /**
   * Get a list of customer reviews for a specific app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviews}
   */
  async listCustomerReviews(
    appId: string,
    filters: {
      rating?: number;
      territory?: string;
    } = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomerReviewResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listCustomerReviews(appId, filters, listQuery);
  }

  /**
   * Get the response to a specific customer review.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviews-_id_-response}
   */
  async getCustomerReviewResponse(
    reviewId: string,
  ): Promise<CustomerReviewResponseResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getCustomerReviewResponse(reviewId);
  }

  /**
   * Create a response or replace an existing response you wrote to a customer review.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-customerreviewresponses}
   */
  async createCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource> {
    const connectClient = await this.openClient();

    return connectClient.createCustomerReviewResponse(reviewId, responseBody);
  }

  /**
   * Delete a specific response you wrote to a customer review.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-customerreviewresponses-_id_}
   */
  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deleteCustomerReviewResponse(responseId);
  }

  /**
   * Get a list of the users on your team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-users}
   */
  async listUsers(listQuery: AppleListQuery | null = null): Promise<UserResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listUsers(listQuery);
  }

  /**
   * Get a list of pending invitations to join your team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-userinvitations}
   */
  async listUserInvitations(
    listQuery: AppleListQuery | null = null,
  ): Promise<UserInvitationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listUserInvitations(listQuery);
  }

  /**
   * Invite a user with assigned user roles to join your team.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-userinvitations}
   */
  async inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource> {
    const connectClient = await this.openClient();

    return connectClient.inviteUser(invite);
  }

  /**
   * Remove a user from your team.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-users-_id_}
   */
  async deleteUser(userId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deleteUser(userId);
  }

  /**
   * Cancel a pending invitation for a user to join your team.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-userinvitations-_id_}
   */
  async cancelUserInvitation(invitationId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.cancelUserInvitation(invitationId);
  }

  /**
   * Downloads a sales and trends report.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-salesreports}
   */
  async getSalesReport(query: SalesReportQuery): Promise<Buffer> {
    const connectClient = await this.openClient();

    return connectClient.getSalesReport(query);
  }

  /**
   * Downloads a finance report.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-financereports}
   */
  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    const connectClient = await this.openClient();

    return connectClient.getFinanceReport(query);
  }

  /**
   * Read analytics report requests for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-analyticsreportrequests}
   */
  async listAnalyticsReportRequests(
    appId: string,
    accessType: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportRequestResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAnalyticsReportRequests(appId, accessType, listQuery);
  }

  /**
   * Request analytics reports for your apps.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-analyticsreportrequests}
   */
  async createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> {
    const connectClient = await this.openClient();

    return connectClient.createAnalyticsReportRequest(appId, accessType);
  }

  /**
   * Get a list of reports generated from a specific analytics report request.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportrequests-_id_-reports}
   */
  async listAnalyticsReports(
    requestId: string,
    filters: {
      category?: string;
      name?: string;
    } = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAnalyticsReports(requestId, filters, listQuery);
  }

  /**
   * Read list of all the granularity options for a specific type of analytics report.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreports-_id_-instances}
   */
  async listAnalyticsReportInstances(
    reportId: string,
    filters: {
      granularity?: string;
      processingDate?: string;
    } = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportInstanceResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAnalyticsReportInstances(reportId, filters, listQuery);
  }

  /**
   * Get details for a specific analytics report segment.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_-segments}
   */
  async listAnalyticsReportSegments(
    instanceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AnalyticsReportSegmentResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAnalyticsReportSegments(instanceId, listQuery);
  }

  /**
   * Downloads one analytics report file.
   *
   * Launch downloads the report address Apple returned.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-analyticsreportinstances-_id_-segments}
   */
  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    const connectClient = await this.openClient();

    return connectClient.downloadAnalyticsSegment(url);
  }

  /**
   * Get a list of in-app events for a specific app.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appevents}
   */
  async listAppEvents(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppEventResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppEvents(appId, listQuery);
  }

  /**
   * Get a list of all localizations for a specific in-app event.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appevents-_id_-localizations}
   */
  async listAppEventLocalizations(
    eventId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppEventLocalizationResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAppEventLocalizations(eventId, listQuery);
  }

  /**
   * Create a new in-app event for your app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appevents}
   */
  async createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource> {
    const connectClient = await this.openClient();

    return connectClient.createAppEvent(appId, attributes);
  }

  /**
   * Delete an in-app event and its related metadata.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appevents-_id_}
   */
  async deleteAppEvent(eventId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deleteAppEvent(eventId);
  }

  /**
   * Add a new localization for an in-app event.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appeventlocalizations}
   */
  async createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.createAppEventLocalization(eventId, locale, attributes);
  }

  /**
   * Update the localized metadata for a specific in-app event.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appeventlocalizations-_id_}
   */
  async updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const connectClient = await this.openClient();

    return connectClient.updateAppEventLocalization(localizationId, attributes);
  }

  /**
   * Lists the screenshot sets on a version localization.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-appscreenshotsets}
   */
  async listScreenshotSets(
    versionLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotSetResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listScreenshotSets(versionLocalizationId, listQuery);
  }

  /**
   * Creates a screenshot set on a version localization.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshotsets}
   */
  async createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    const connectClient = await this.openClient();

    return connectClient.createScreenshotSet(versionLocalizationId, displayType);
  }

  /**
   * Lists the screenshot sets on an experiment treatment.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionexperimenttreatmentlocalizations-_id_-appscreenshotsets}
   */
  async listTreatmentScreenshotSets(
    treatmentLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotSetResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listTreatmentScreenshotSets(treatmentLocalizationId, listQuery);
  }

  /**
   * Creates a screenshot set on an experiment treatment.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshotsets}
   */
  async createTreatmentScreenshotSet(
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    const connectClient = await this.openClient();

    return connectClient.createTreatmentScreenshotSet(treatmentLocalizationId, displayType);
  }

  /**
   * List all ordered screenshots in a screenshot set.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_-appscreenshots}
   */
  async listScreenshots(
    setId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ScreenshotResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listScreenshots(setId, listQuery);
  }

  /**
   * Delete an app screenshot that is associated with a screenshot set.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appscreenshots-_id_}
   */
  async deleteScreenshot(screenshotId: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.deleteScreenshot(screenshotId);
  }

  /**
   * Change the order of the screenshots in a screenshot set.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appscreenshotsets-_id_-relationships-appscreenshots}
   */
  async reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.reorderScreenshots(setId, screenshotIds);
  }

  /**
   * Uploads a screenshot into a screenshot set.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appscreenshots}
   */
  async uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<string> {
    const connectClient = await this.openClient();

    return connectClient.uploadScreenshot(setId, fileName, filePath);
  }

  /**
   * Get information about review screenshot for a specific auto-renewable subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-subscriptions-_id_-appstorereviewscreenshot}
   */
  async getSubscriptionReviewScreenshot(
    subscriptionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewScreenshotResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getSubscriptionReviewScreenshot(subscriptionId, listQuery);
  }

  /**
   * Uploads the review screenshot for a subscription.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-subscriptionappstorereviewscreenshots}
   */
  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.uploadSubscriptionReviewScreenshot(subscriptionId, fileName, filePath);
  }

  /**
   * List all app preview sets for a specific localization.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-apppreviewsets}
   */
  async listPreviewSets(
    versionLocalizationId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PreviewSetResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listPreviewSets(versionLocalizationId, listQuery);
  }

  /**
   * Add a new app preview set to an App Store version localization for a specific app preview type
   * and display size.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppreviewsets}
   */
  async createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> {
    const connectClient = await this.openClient();

    return connectClient.createPreviewSet(versionLocalizationId, previewType);
  }

  /**
   * List all ordered app previews in a preview set.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apppreviewsets-_id_-apppreviews}
   */
  async listPreviews(
    setId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<PreviewResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listPreviews(setId, listQuery);
  }

  /**
   * Uploads an app preview into a preview set.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppreviews}
   */
  async uploadPreview(setId: string, fileName: string, filePath: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.uploadPreview(setId, fileName, filePath);
  }

  /**
   * List all the alternative distribution domains for your account.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributiondomains}
   */
  async listAlternativeDistributionDomains(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionDomainResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAlternativeDistributionDomains(listQuery);
  }

  /**
   * Add an alternative distribution domain to your account.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributiondomains}
   */
  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createAlternativeDistributionDomain(domain, referenceName);
  }

  /**
   * List the alternative distribution key for your account.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-alternativedistributionkeys}
   */
  async listAlternativeDistributionKeys(
    listQuery: AppleListQuery | null = null,
  ): Promise<AlternativeDistributionKeyResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listAlternativeDistributionKeys(listQuery);
  }

  /**
   * Add an alternative distribution key for your alternative marketplace app or web distribution.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-alternativedistributionkeys}
   */
  async createAlternativeDistributionKey(publicKey: string): Promise<{
    id: string;
  }> {
    const connectClient = await this.openClient();

    return connectClient.createAlternativeDistributionKey(publicKey);
  }

  /**
   * List all merchant Ids for your team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-merchantids}
   */
  async listMerchantIds(listQuery: AppleListQuery | null = null): Promise<MerchantIdResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listMerchantIds(listQuery);
  }

  /**
   * Add a new merchant ID to your team.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-merchantids}
   */
  async createMerchantId(identifier: string, name: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createMerchantId(identifier, name);
  }

  /**
   * Lists the Wallet pass type ids on this team.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-passtypeids}
   */
  async listPassTypeIds(listQuery: AppleListQuery | null = null): Promise<PassTypeIdResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listPassTypeIds(listQuery);
  }

  /**
   * Create a new identifier for use with a pass type ID certificate using a certificate signing
   * request.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-passtypeids}
   */
  async createPassTypeId(identifier: string, name: string): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createPassTypeId(identifier, name);
  }

  /**
   * Get Game Center detail information for an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-gamecenterdetail}
   */
  async getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null> {
    const connectClient = await this.openClient();

    return connectClient.getGameCenterDetail(appId);
  }

  /**
   * Create a Game Center detail for an app.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterdetails}
   */
  async createGameCenterDetail(appId: string): Promise<GameCenterDetailResource> {
    const connectClient = await this.openClient();

    return connectClient.createGameCenterDetail(appId);
  }

  /**
   * Get a list of achievements for a specific Game Center detail.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterachievementsv2}
   */
  async listGameCenterAchievements(
    detailId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<GameCenterAchievementResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listGameCenterAchievements(detailId, listQuery);
  }

  /**
   * Create a Game Center achievement.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievements}
   */
  async createGameCenterAchievement(
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    const connectClient = await this.openClient();

    return connectClient.createGameCenterAchievement(detailId, attributes);
  }

  /**
   * Create a Game Center achievement localization.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievementlocalizations}
   */
  async createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createGameCenterAchievementLocalization(versionId, fields);
  }

  /**
   * Get a list of leaderboards for a specific Game Center detail.
   *
   * Launch asks for at most 200 records on a page.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboardsv2}
   */
  async listGameCenterLeaderboards(
    detailId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<GameCenterLeaderboardResource[]> {
    const connectClient = await this.openClient();

    return connectClient.listGameCenterLeaderboards(detailId, listQuery);
  }

  /**
   * Create a Game Center leaderboard.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboards}
   */
  async createGameCenterLeaderboard(
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    const connectClient = await this.openClient();

    return connectClient.createGameCenterLeaderboard(detailId, attributes);
  }

  /**
   * Create a Game Center leaderboard localization.
   *
   * @see {@link https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardlocalizations}
   */
  async createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      formatterOverride?: LeaderboardFormatter;
    },
  ): Promise<void> {
    const connectClient = await this.openClient();

    return connectClient.createGameCenterLeaderboardLocalization(versionId, fields);
  }

  private async readPage(path: string): Promise<ApplePage> {
    const page = await this.send('GET', path, null);

    return page as ApplePage;
  }

  private async send(method: string, path: string, document: unknown): Promise<unknown> {
    const signedToken = await this.sign();
    const hasDocument = document != null;
    let requestInit: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${signedToken}` },
    };

    if (hasDocument) {
      requestInit = {
        method,
        headers: {
          Authorization: `Bearer ${signedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(document),
      };
    }

    try {
      var appleReply = await fetch(`https://api.appstoreconnect.apple.com${path}`, requestInit);
    } catch (error) {
      throw new Error(`App Store Connect did not answer ${method} ${path}`, { cause: error });
    }

    const isRefused = appleReply.ok == false;

    if (isRefused) {
      throw new Error(`App Store Connect refused ${method} ${path}`, { cause: appleReply.status });
    }

    try {
      var appleDocument = await appleReply.json();
    } catch (error) {
      throw new Error('App Store Connect sent a page that is not JSON', { cause: error });
    }

    return appleDocument;
  }

  private async sign(): Promise<string> {
    const accountKey = this.accountKey;

    if (accountKey != null) {
      const issuedAt = Math.floor(Date.now() / 1000);

      return signAppStoreConnectToken(accountKey, issuedAt);
    }

    return this.token.sign();
  }

  private async openClient(): Promise<AppStoreConnectClient> {
    const storeClient = this.storeClient;

    if (storeClient != null) {
      return storeClient;
    }

    const accountKey = this.accountKey;

    if (accountKey != null) {
      this.storeClient = new AppStoreConnectClient(accountKey);

      return this.storeClient;
    }

    const savedKey = await this.token.accountKey();

    this.storeClient = new AppStoreConnectClient(savedKey);

    return this.storeClient;
  }
}

function namesFrom(page: ApplePage, field: 'name' | 'productId' | 'versionString'): string[] {
  const rows = page.data;

  const isMissing = rows == null;

  if (isMissing) {
    return [];
  }

  const names: string[] = [];

  for (const row of rows) {
    const attributes = row.attributes;

    const isBlankAttributes = attributes == null;

    if (isBlankAttributes) {
      continue;
    }

    const name = attributes[field];

    const isBlank = name == null;

    if (isBlank) {
      continue;
    }

    names.push(name);
  }

  return names;
}
