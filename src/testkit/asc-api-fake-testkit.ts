import { vi } from 'vitest';
import type { AscSurfacesApi } from '../types/plan.ts';

/** A fully-stubbed AscSurfacesApi. */
export function makeAscApiFake(overrides: Partial<AscSurfacesApi> = {}): AscSurfacesApi {
  const base: AscSurfacesApi = {
    // shared
    getAppId: vi.fn().mockResolvedValue('app1'),
    // catalog reads
    findBundleId: vi.fn().mockResolvedValue(null),
    listBundleIdCapabilities: vi.fn().mockResolvedValue([]),
    listInAppPurchases: vi.fn().mockResolvedValue([]),
    listInAppPurchaseLocalizations: vi.fn().mockResolvedValue([]),
    inAppPurchaseHasPrice: vi.fn().mockResolvedValue(false),
    findInAppPurchasePricePoint: vi.fn().mockResolvedValue(null),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listSubscriptionGroupLocalizations: vi.fn().mockResolvedValue([]),
    listSubscriptions: vi.fn().mockResolvedValue([]),
    listSubscriptionLocalizations: vi.fn().mockResolvedValue([]),
    subscriptionHasPrice: vi.fn().mockResolvedValue(false),
    findSubscriptionPricePoint: vi.fn().mockResolvedValue(null),
    getEditableAppInfoId: vi.fn().mockResolvedValue('appinfo1'),
    listAppInfoLocalizations: vi.fn().mockResolvedValue([]),
    getEditableVersionId: vi.fn().mockResolvedValue('version1'),
    listVersionLocalizations: vi.fn().mockResolvedValue([]),
    // catalog writes (never called in dry-run)
    enableCapability: vi.fn(),
    disableCapability: vi.fn(),
    createInAppPurchase: vi.fn(),
    createInAppPurchaseLocalization: vi.fn(),
    createInAppPurchasePriceSchedule: vi.fn(),
    createSubscriptionGroup: vi.fn(),
    createSubscriptionGroupLocalization: vi.fn(),
    createSubscription: vi.fn(),
    createSubscriptionLocalization: vi.fn(),
    createSubscriptionPrice: vi.fn(),
    createAppInfoLocalization: vi.fn(),
    updateAppInfoLocalization: vi.fn(),
    createVersionLocalization: vi.fn(),
    updateVersionLocalization: vi.fn(),
    // release reads
    getAppInfo: vi.fn().mockResolvedValue(null),
    getAgeRatingDeclaration: vi.fn().mockResolvedValue(null),
    findAppPricePoint: vi.fn().mockResolvedValue(null),
    getCurrentAppPrice: vi.fn().mockResolvedValue(null),
    findEditableAppStoreVersion: vi.fn().mockResolvedValue(null),
    getAppStoreReviewDetail: vi.fn().mockResolvedValue(null),
    // release writes
    updateAppInfoCategories: vi.fn(),
    updateAgeRatingDeclaration: vi.fn(),
    createAppPriceSchedule: vi.fn(),
    createAppStoreReviewDetail: vi.fn(),
    updateAppStoreReviewDetail: vi.fn(),
    // game center reads
    getGameCenterDetail: vi.fn().mockResolvedValue(null),
    listGameCenterAchievements: vi.fn().mockResolvedValue([]),
    listGameCenterLeaderboards: vi.fn().mockResolvedValue([]),
    // game center writes
    createGameCenterDetail: vi.fn(),
    createGameCenterAchievement: vi.fn(),
    createGameCenterAchievementLocalization: vi.fn(),
    createGameCenterLeaderboard: vi.fn(),
    createGameCenterLeaderboardLocalization: vi.fn(),
    // app clips reads
    listAppClips: vi.fn().mockResolvedValue([]),
    listAppClipDefaultExperiences: vi.fn().mockResolvedValue([]),
    listAppClipDefaultExperienceLocalizations: vi.fn().mockResolvedValue([]),
    // app clips writes
    createAppClipDefaultExperience: vi.fn(),
    updateAppClipDefaultExperienceAction: vi.fn(),
    createAppClipDefaultExperienceLocalization: vi.fn(),
    updateAppClipDefaultExperienceLocalization: vi.fn(),
    // availability
    getAppAvailability: vi.fn().mockResolvedValue(null),
    createAppAvailability: vi.fn(),
    updateAppAvailabilityTerritories: vi.fn(),
    // accessibility
    listAccessibilityDeclarations: vi.fn().mockResolvedValue([]),
    createAccessibilityDeclaration: vi.fn(),
    updateAccessibilityDeclaration: vi.fn(),
    // version experiments
    listVersionExperiments: vi.fn().mockResolvedValue([]),
    createVersionExperiment: vi.fn(),
    listExperimentTreatments: vi.fn().mockResolvedValue([]),
    createExperimentTreatment: vi.fn(),
    startVersionExperiment: vi.fn(),
    listExperimentTreatmentLocalizations: vi.fn().mockResolvedValue([]),
    createExperimentTreatmentLocalization: vi.fn(),
    listTreatmentScreenshotSets: vi.fn().mockResolvedValue([]),
    createTreatmentScreenshotSet: vi.fn(),
    listReviewSubmissions: vi.fn().mockResolvedValue([]),
    createReviewSubmission: vi.fn(),
    addExperimentReviewSubmissionItem: vi.fn(),
    submitReviewSubmission: vi.fn(),
    // custom product pages
    listCustomProductPages: vi.fn().mockResolvedValue([]),
    createCustomProductPage: vi.fn(),
    listCustomProductPageVersions: vi.fn().mockResolvedValue([]),
    listCustomProductPageLocalizations: vi.fn().mockResolvedValue([]),
    createCustomProductPageLocalization: vi.fn(),
    updateCustomProductPageLocalization: vi.fn(),
    // wallet (team-level)
    listMerchantIds: vi.fn().mockResolvedValue([]),
    createMerchantId: vi.fn(),
    listPassTypeIds: vi.fn().mockResolvedValue([]),
    createPassTypeId: vi.fn(),
    // EU distribution (team-level)
    listAlternativeDistributionDomains: vi.fn().mockResolvedValue([]),
    createAlternativeDistributionDomain: vi.fn(),
    // offers reads (catalog reads above are shared)
    listSubscriptionOfferCodes: vi.fn().mockResolvedValue([]),
    listPromotionalOffers: vi.fn().mockResolvedValue([]),
    listIntroductoryOffers: vi.fn().mockResolvedValue([]),
    listWinBackOffers: vi.fn().mockResolvedValue([]),
    listPromotedPurchases: vi.fn().mockResolvedValue([]),
    // offers writes
    createSubscriptionOfferCode: vi.fn(),
    createPromotionalOffer: vi.fn(),
    createIntroductoryOffer: vi.fn(),
    createWinBackOffer: vi.fn(),
    createPromotedPurchase: vi.fn(),
    reorderPromotedPurchases: vi.fn(),
    // screenshots reads (getEditableVersionId / listVersionLocalizations above are shared)
    listScreenshotSets: vi.fn().mockResolvedValue([]),
    listScreenshots: vi.fn().mockResolvedValue([]),
    getSubscriptionReviewScreenshot: vi.fn().mockResolvedValue(null),
    // screenshots writes
    createScreenshotSet: vi.fn(),
    uploadScreenshot: vi.fn(),
    deleteScreenshot: vi.fn(),
    reorderScreenshots: vi.fn(),
    uploadSubscriptionReviewScreenshot: vi.fn(),
    // preview videos reads
    listPreviewSets: vi.fn().mockResolvedValue([]),
    listPreviews: vi.fn().mockResolvedValue([]),
    // preview videos writes
    createPreviewSet: vi.fn(),
    uploadPreview: vi.fn(),
  };
  return { ...base, ...overrides };
}
