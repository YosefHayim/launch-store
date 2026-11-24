// Declares how Launch calls App Store Connect, from raw requests to store edits.

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
import type {
  ProvisioningProfileType,
  LocaleCopy,
  ResourceList,
  AppInfoStates,
  VersionStates,
  AppleResource,
  UploadOperation,
} from './shared.ts';
import type { components } from '../types/apple-api-types.ts';
import type { AppleListQuery } from './list-query.ts';

export interface AscHost {
  token(): Promise<string>;

  request<T>(method: string, pathOrUrl: string, requestDocument?: unknown): Promise<T>;

  v2(path: string): string;

  requestAll<A>(path: string): Promise<AppleResource<A>[]>;

  requestPages<Page extends { links?: { next?: string } }>(path: string): Promise<Page[]>;

  getOptional<T>(load: () => Promise<T>): Promise<T | null>;

  createResource<A = unknown>(
    path: string,
    member: { type: string; attributes?: object; relationships?: object },
  ): Promise<{ id: string; attributes: A }>;

  updateResource(
    path: string,
    member: { type: string; id: string; attributes: object },
  ): Promise<void>;

  deleteResource(path: string): Promise<void>;

  getAppId(bundleId: string): Promise<string | null>;

  getLatestBuildNumber(bundleId: string, listQuery?: AppleListQuery | null): Promise<number>;

  getLatestMarketingVersion(
    bundleId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<string | null>;

  getBuildProcessingState(
    bundleId: string,
    buildNumber: number,
    listQuery?: AppleListQuery | null,
  ): Promise<string | null>;

  createBuildUpload(
    appId: string,
    version: string,
    buildNumber: number,
    platform: components['schemas']['Platform'],
  ): Promise<string>;

  uploadBuildFile(buildUploadId: string, fileName: string, binaryPath: string): Promise<void>;

  getBuildUploadStatus(
    buildUploadId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BuildUploadStatus>;

  findBuild(
    bundleId: string,
    buildNumber: number,
    listQuery?: AppleListQuery | null,
  ): Promise<{ id: string; usesNonExemptEncryption: boolean | null } | null>;

  setBuildUsesNonExemptEncryption(buildId: string, fieldValue: boolean): Promise<void>;

  getEditableAppInfoId(appId: string): Promise<string | null>;

  getCurrentAppInfoId(appId: string): Promise<string | null>;

  listAppInfoStates(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ResourceList<AppInfoStates>['data']>;

  listAppInfoLocalizations(
    appInfoId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ListingLocalization[]>;

  listAccountDeletionUrls(
    appInfoId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<{ locale: string; url: string }[]>;

  createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void>;

  updateAppInfoLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;

  listEncryptionDeclarations(
    bundleId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<EncryptionDeclarationResource[]>;

  linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void>;

  getEditableVersionId(appId: string): Promise<string | null>;

  getCurrentVersionId(appId: string): Promise<string | null>;

  listVersionStates(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ResourceList<VersionStates>['data']>;

  listVersionLocalizations(
    versionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ListingLocalization[]>;

  createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void>;

  updateVersionLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;

  listAppClips(appId: string, listQuery?: AppleListQuery | null): Promise<AppClipResource[]>;

  listAppClipDefaultExperiences(
    appClipId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppClipDefaultExperienceResource[]>;

  createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{ id: string }>;

  updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void>;

  listAppClipDefaultExperienceLocalizations(
    experienceId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppClipLocalizationResource[]>;

  createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void>;

  updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void>;

  assertReady(): Promise<void>;

  checkRequiredAgreements(): Promise<boolean>;

  resolveTeamId(listQuery?: AppleListQuery | null): Promise<string | null>;

  listAppNames(listQuery?: AppleListQuery | null): Promise<string[]>;

  listApps(
    listQuery?: AppleListQuery | null,
  ): Promise<{ id: string; name: string; bundleId: string | null }[]>;

  findBundleId(
    identifier: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BundleIdResource | null>;

  createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform?: components['schemas']['BundleIdPlatform'],
  ): Promise<BundleIdResource>;

  listDistributionCertificates(listQuery?: AppleListQuery | null): Promise<CertificateResource[]>;

  createCertificate(csrContent: string): Promise<CertificateResource>;

  findProfileByName(name: string): Promise<ProfileResource | null>;

  createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType?: ProvisioningProfileType,
  ): Promise<ProfileResource>;

  deleteProfile(id: string): Promise<void>;

  listDevices(listQuery?: AppleListQuery | null): Promise<DeviceResource[]>;

  findDeviceByUdid(udid: string): Promise<DeviceResource | null>;

  registerDevice(udid: string, name: string): Promise<DeviceResource>;

  createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: readonly string[],
    profileType?: ProvisioningProfileType,
  ): Promise<ProfileResource>;

  listBundleIdCapabilities(
    bundleIdResourceId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BundleIdCapabilityResource[]>;

  listProfilesForBundleId(
    bundleIdResourceId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ProfileResource[]>;

  enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource>;

  disableCapability(capabilityId: string): Promise<void>;

  listSandboxTesters(listQuery?: AppleListQuery | null): Promise<SandboxTesterResource[]>;

  clearSandboxTesterPurchaseHistory(testerIds: readonly string[]): Promise<void>;

  listInAppPurchases(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<InAppPurchaseResource[]>;

  createInAppPurchase(
    appId: string,
    input: { productId: string; name: string; inAppPurchaseType: string },
  ): Promise<InAppPurchaseResource>;

  listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]>;

  createInAppPurchaseLocalization(iapId: string, copy: LocaleCopy): Promise<LocalizationResource>;

  listSubscriptionGroups(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<SubscriptionGroupResource[]>;

  createSubscriptionGroup(appId: string, referenceName: string): Promise<SubscriptionGroupResource>;

  listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]>;

  createSubscriptionGroupLocalization(
    groupId: string,
    copy: Omit<LocaleCopy, 'description'>,
  ): Promise<LocalizationResource>;

  listSubscriptions(
    groupId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<SubscriptionResource[]>;

  createSubscription(
    groupId: string,
    input: { productId: string; name: string; subscriptionPeriod: string; groupLevel: number },
  ): Promise<SubscriptionResource>;

  listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]>;

  createSubscriptionLocalization(
    subscriptionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource>;

  subscriptionHasPrice(subscriptionId: string): Promise<boolean>;

  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
    listQuery?: AppleListQuery | null,
  ): Promise<PricePointResource | null>;

  createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void>;

  listSubscriptionOfferCodes(
    subscriptionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<OfferCodeResource[]>;

  createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource>;

  deactivateOfferCode(offerCodeId: string): Promise<void>;

  createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void>;

  createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void>;

  listPromotionalOffers(
    subscriptionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<PromotionalOfferResource[]>;

  createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource>;

  listIntroductoryOffers(
    subscriptionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<IntroductoryOfferResource[]>;

  createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void>;

  listWinBackOffers(
    subscriptionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<WinBackOfferResource[]>;

  createWinBackOffer(input: WinBackOfferCreate): Promise<void>;

  listPromotedPurchases(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<PromotedPurchaseResource[]>;

  createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource>;

  reorderPromotedPurchases(appId: string, orderedIds: readonly string[]): Promise<void>;

  inAppPurchaseHasPrice(iapId: string): Promise<boolean>;

  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
    listQuery?: AppleListQuery | null,
  ): Promise<PricePointResource | null>;

  createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void>;

  listBetaGroups(appId: string, listQuery?: AppleListQuery | null): Promise<BetaGroupResource[]>;

  findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null>;

  createBetaGroup(appId: string, name: string): Promise<BetaGroupResource>;

  listBetaTestersInGroup(
    groupId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BetaTesterResource[]>;

  findBetaTesterByEmail(
    email: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BetaTesterResource | null>;

  createBetaTester(
    groupId: string,
    input: { email: string; firstName?: string; lastName?: string },
  ): Promise<BetaTesterResource>;

  addTestersToGroup(groupId: string, testerIds: readonly string[]): Promise<void>;

  removeTestersFromGroup(groupId: string, testerIds: readonly string[]): Promise<void>;

  getAppInfo(appId: string, listQuery?: AppleListQuery | null): Promise<AppInfoResource | null>;

  updateAppInfoCategories(
    appInfoId: string,
    categories: { primaryCategoryId?: string; secondaryCategoryId?: string | null },
  ): Promise<void>;

  getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null>;

  updateAgeRatingDeclaration(
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void>;

  listAccessibilityDeclarations(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AccessibilityDeclarationResource[]>;

  createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource>;

  updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & { publish?: boolean },
  ): Promise<void>;

  getAppAvailability(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppAvailabilityResource | null>;

  createAppAvailability(
    appId: string,
    input: { availableInNewTerritories: boolean; territories: string[] },
  ): Promise<void>;

  updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void>;

  listCustomProductPages(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<CustomProductPageResource[]>;

  createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource>;

  listCustomProductPageVersions(
    pageId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<CustomProductPageVersionResource[]>;

  listCustomProductPageLocalizations(
    versionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<CustomProductPageLocalizationResource[]>;

  createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void>;

  updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void>;

  listVersionExperiments(
    appId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<VersionExperimentResource[]>;

  createVersionExperiment(
    appId: string,
    input: { name: string; platform: string; trafficProportion: number },
  ): Promise<VersionExperimentResource>;

  listExperimentTreatments(
    experimentId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ExperimentTreatmentResource[]>;

  createExperimentTreatment(
    experimentId: string,
    input: { name: string; appIconName?: string },
  ): Promise<ExperimentTreatmentResource>;

  startVersionExperiment(experimentId: string): Promise<void>;

  listExperimentTreatmentLocalizations(
    treatmentId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ExperimentTreatmentLocalizationResource[]>;

  createExperimentTreatmentLocalization(
    treatmentId: string,
    locale: string,
  ): Promise<ExperimentTreatmentLocalizationResource>;

  findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
    listQuery?: AppleListQuery | null,
  ): Promise<PricePointResource | null>;

  getCurrentAppPrice(
    appId: string,
    territory: string,
    listQuery?: AppleListQuery | null,
  ): Promise<string | null>;

  createAppPriceSchedule(appId: string, baseTerritory: string, pricePointId: string): Promise<void>;

  findEditableAppStoreVersion(
    appId: string,
    platform: string,
    listQuery?: AppleListQuery | null,
  ): Promise<{ id: string; copyright: string } | null>;

  getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null>;

  createAppStoreReviewDetail(
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{ id: string }>;

  updateAppStoreReviewDetail(
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void>;

  listCustomerReviews(
    appId: string,
    filters?: { rating?: number; territory?: string },
    listQuery?: AppleListQuery | null,
  ): Promise<CustomerReviewResource[]>;

  getCustomerReviewResponse(reviewId: string): Promise<CustomerReviewResponseResource | null>;

  createCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource>;

  deleteCustomerReviewResponse(responseId: string): Promise<void>;

  listBetaFeedbackCrashSubmissions(
    appId: string,
    query?: BetaFeedbackQuery,
    listQuery?: AppleListQuery | null,
  ): Promise<BetaFeedbackCrashSubmissionResource[]>;

  listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query?: BetaFeedbackQuery,
    listQuery?: AppleListQuery | null,
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]>;

  downloadBetaFeedbackScreenshot(url: string): Promise<Buffer>;

  listUsers(listQuery?: AppleListQuery | null): Promise<UserResource[]>;

  listUserInvitations(listQuery?: AppleListQuery | null): Promise<UserInvitationResource[]>;

  inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource>;

  deleteUser(userId: string): Promise<void>;

  cancelUserInvitation(invitationId: string): Promise<void>;

  getSalesReport(query: SalesReportQuery): Promise<Buffer>;

  getFinanceReport(query: FinanceReportQuery): Promise<Buffer>;

  listAnalyticsReportRequests(
    appId: string,
    accessType: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AnalyticsReportRequestResource[]>;

  createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource>;

  listAnalyticsReports(
    requestId: string,
    filters?: { category?: string; name?: string },
    listQuery?: AppleListQuery | null,
  ): Promise<AnalyticsReportResource[]>;

  listAnalyticsReportInstances(
    reportId: string,
    filters?: { granularity?: string; processingDate?: string },
    listQuery?: AppleListQuery | null,
  ): Promise<AnalyticsReportInstanceResource[]>;

  listAnalyticsReportSegments(
    instanceId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AnalyticsReportSegmentResource[]>;

  downloadAnalyticsSegment(url: string): Promise<Buffer>;

  listBuilds(
    appId: string,
    limit?: number,
    listQuery?: AppleListQuery | null,
  ): Promise<BuildResource[]>;

  findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BuildResource | null>;

  listBetaBuildLocalizations(
    buildId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<BetaBuildLocalizationResource[]>;

  createBetaBuildLocalization(buildId: string, locale: string, whatsNew: string): Promise<void>;

  updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void>;

  getBetaAppReviewSubmission(buildId: string): Promise<BetaAppReviewSubmissionResource | null>;

  createBetaAppReviewSubmission(buildId: string): Promise<void>;

  listAppStoreVersions(
    appId: string,
    platform: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppStoreVersionResource[]>;

  createAppStoreVersion(
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource>;

  updateAppStoreVersion(
    versionId: string,
    input: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void>;

  selectBuildForVersion(versionId: string, buildId: string): Promise<void>;

  listAppStoreVersionLocalizations(
    versionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppStoreVersionLocalizationResource[]>;

  createAppStoreVersionLocalization(
    versionId: string,
    input: { locale: string; whatsNew: string },
  ): Promise<AppStoreVersionLocalizationResource>;

  updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void>;

  getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null>;

  createPhasedRelease(versionId: string): Promise<PhasedReleaseResource>;

  updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void>;

  deletePhasedRelease(phasedReleaseId: string): Promise<void>;

  listReviewSubmissions(
    appId: string,
    platform: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ReviewSubmissionResource[]>;

  createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource>;

  addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void>;

  addExperimentReviewSubmissionItem(submissionId: string, experimentId: string): Promise<void>;

  submitReviewSubmission(submissionId: string): Promise<void>;

  createAppStoreVersionReleaseRequest(versionId: string): Promise<void>;

  cancelReviewSubmission(submissionId: string): Promise<void>;

  getReviewSubmission(
    submissionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ReviewSubmissionResource>;

  listAppEvents(appId: string, listQuery?: AppleListQuery | null): Promise<AppEventResource[]>;

  listAppEventLocalizations(
    eventId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<AppEventLocalizationResource[]>;

  createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource>;

  deleteAppEvent(eventId: string): Promise<void>;

  createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource>;

  updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource>;

  listScreenshotSets(
    versionLocalizationId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ScreenshotSetResource[]>;

  createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource>;

  listTreatmentScreenshotSets(
    treatmentLocalizationId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ScreenshotSetResource[]>;

  createTreatmentScreenshotSet(
    treatmentLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource>;

  listScreenshots(setId: string, listQuery?: AppleListQuery | null): Promise<ScreenshotResource[]>;

  deleteScreenshot(screenshotId: string): Promise<void>;

  reorderScreenshots(setId: string, screenshotIds: readonly string[]): Promise<void>;

  uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<string>;

  getSubscriptionReviewScreenshot(
    subscriptionId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<ReviewScreenshotResource | null>;

  uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void>;

  listPreviewSets(
    versionLocalizationId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<PreviewSetResource[]>;

  createPreviewSet(versionLocalizationId: string, previewType: string): Promise<PreviewSetResource>;

  listPreviews(setId: string, listQuery?: AppleListQuery | null): Promise<PreviewResource[]>;

  uploadPreview(setId: string, fileName: string, filePath: string): Promise<void>;

  listAlternativeDistributionDomains(
    listQuery?: AppleListQuery | null,
  ): Promise<AlternativeDistributionDomainResource[]>;

  createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void>;

  listAlternativeDistributionKeys(
    listQuery?: AppleListQuery | null,
  ): Promise<AlternativeDistributionKeyResource[]>;

  createAlternativeDistributionKey(publicKey: string): Promise<{ id: string }>;

  listMerchantIds(listQuery?: AppleListQuery | null): Promise<MerchantIdResource[]>;

  createMerchantId(identifier: string, name: string): Promise<void>;

  listPassTypeIds(listQuery?: AppleListQuery | null): Promise<PassTypeIdResource[]>;

  createPassTypeId(identifier: string, name: string): Promise<void>;

  getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null>;

  createGameCenterDetail(appId: string): Promise<GameCenterDetailResource>;

  listGameCenterAchievements(
    detailId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<GameCenterAchievementResource[]>;

  createGameCenterAchievement(
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{ id: string; versionId: string | null }>;

  createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void>;

  listGameCenterLeaderboards(
    detailId: string,
    listQuery?: AppleListQuery | null,
  ): Promise<GameCenterLeaderboardResource[]>;

  createGameCenterLeaderboard(
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{ id: string; versionId: string | null }>;

  createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: { locale: string; name: string; formatterOverride?: LeaderboardFormatter },
  ): Promise<void>;

  reserveAsset(
    type: string,
    parent: { relationship: string; type: string; id: string },
    fileName: string,
    fileSize: number,
    assetAttributes?: Record<string, string>,
  ): Promise<{ id: string; operations: UploadOperation[] }>;

  commitAsset(type: string, id: string, bytes: Buffer): Promise<void>;
}
