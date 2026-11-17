import type { AscKey } from '@core/types/credentials.js';
import { makeAppStoreConnectRequests } from './api-client.js';
import { makeAppsApi } from './app-store/apps-and-metadata/apps.js';
import { makeAppInfosApi } from './app-store/apps-and-metadata/app-infos.js';
import { makeAppStoreVersionsApi } from './app-store/apps-and-metadata/app-store-versions.js';
import { makeScreenshotsAndPreviewsApi } from './app-store/apps-and-metadata/screenshots-and-previews.js';
import { makeAccessibilityDeclarationsApi } from './app-store/apps-and-metadata/accessibility-declarations.js';
import { makeBetaFeedbackApi } from './testflight/beta-feedback.js';
import { makeBetaAppReviewSubmissionsApi } from './testflight/beta-app-review-submissions.js';
import { makeBuildResourcesApi } from './testflight/build-resources.js';
import { makeBetaTestersAndGroupsApi } from './testflight/beta-testers-and-groups.js';
import { makeBuildsApi } from './app-store/builds.js';
import { makePublishingApi } from './app-store/publishing.js';
import { makeReviewSubmissionsApi } from './app-store/review-submissions.js';
import { makeVersionExperimentsApi } from './app-store/version-experiments.js';
import { makeAppClipsApi } from './app-store/app-clips.js';
import { makeCustomProductPagesApi } from './app-store/custom-product-pages.js';
import { makeAppEventsApi } from './app-store/app-events.js';
import { makeInAppPurchasesApi } from './app-store/in-app-purchases-and-subscriptions/in-app-purchases.js';
import { makeSubscriptionsApi } from './app-store/in-app-purchases-and-subscriptions/subscriptions.js';
import { makePromotedPurchasesApi } from './app-store/in-app-purchases-and-subscriptions/promoted-purchases.js';
import { makeWinBackOffersApi } from './app-store/in-app-purchases-and-subscriptions/win-back-offers.js';
import { makePricingAndAvailabilityApi } from './app-store/pricing-and-availability.js';
import { makeCustomerReviewsApi } from './app-store/customer-reviews.js';
import { makeBundleIdsApi } from './provisioning/bundle-ids.js';
import { makeCertificatesApi } from './provisioning/certificates.js';
import { makeDevicesApi } from './provisioning/devices.js';
import { makeProfilesApi } from './provisioning/profiles.js';
import { makeMerchantAndPassTypeIdsApi } from './provisioning/merchant-and-pass-type-ids.js';
import { makeGameCenterApi } from './game-center.js';
import { makeSalesAndFinanceApi } from './reporting/sales-and-finance.js';
import { makeAnalyticsApi } from './reporting/analytics.js';
import { makeUsersAndAccessApi } from './users-and-access.js';
import { makeAlternativeDistributionApi } from './alternative-distribution.js';

export const makeAppStoreConnectApi = (key: AscKey, operatingSystem?: NodeJS.Platform) => {
  const api = makeAppStoreConnectRequests(key, operatingSystem);
  const apps = makeAppsApi(api);
  const appInfos = makeAppInfosApi(api);
  const appStoreVersions = makeAppStoreVersionsApi(api);
  const screenshotsAndPreviews = makeScreenshotsAndPreviewsApi(api);
  const accessibilityDeclarations = makeAccessibilityDeclarationsApi(api);
  const betaFeedback = makeBetaFeedbackApi(api);
  const betaAppReviewSubmissions = makeBetaAppReviewSubmissionsApi(api);
  const buildResources = makeBuildResourcesApi(api);
  const betaTestersAndGroups = makeBetaTestersAndGroupsApi(api);
  const builds = makeBuildsApi(api, { apps });
  const publishing = makePublishingApi(api);
  const reviewSubmissions = makeReviewSubmissionsApi(api);
  const versionExperiments = makeVersionExperimentsApi(api);
  const appClips = makeAppClipsApi(api);
  const customProductPages = makeCustomProductPagesApi(api);
  const appEvents = makeAppEventsApi(api);
  const inAppPurchases = makeInAppPurchasesApi(api);
  const subscriptions = makeSubscriptionsApi(api);
  const promotedPurchases = makePromotedPurchasesApi(api);
  const winBackOffers = makeWinBackOffersApi(api);
  const pricingAndAvailability = makePricingAndAvailabilityApi(api);
  const customerReviews = makeCustomerReviewsApi(api);
  const bundleIds = makeBundleIdsApi(api);
  const certificates = makeCertificatesApi(api);
  const devices = makeDevicesApi(api);
  const profiles = makeProfilesApi(api);
  const merchantAndPassTypeIds = makeMerchantAndPassTypeIdsApi(api);
  const gameCenter = makeGameCenterApi(api);
  const salesAndFinance = makeSalesAndFinanceApi(api);
  const analytics = makeAnalyticsApi(api);
  const usersAndAccess = makeUsersAndAccessApi(api);
  const alternativeDistribution = makeAlternativeDistributionApi(api);

  return {
    assertReady: api.assertReady,
    checkRequiredAgreements: api.checkRequiredAgreements,
    resolveTeamId: api.resolveTeamId,
    ...apps,
    ...appInfos,
    ...appStoreVersions,
    ...screenshotsAndPreviews,
    ...accessibilityDeclarations,
    ...betaFeedback,
    ...betaAppReviewSubmissions,
    ...buildResources,
    ...betaTestersAndGroups,
    ...builds,
    ...publishing,
    ...reviewSubmissions,
    ...versionExperiments,
    ...appClips,
    ...customProductPages,
    ...appEvents,
    ...inAppPurchases,
    ...subscriptions,
    ...promotedPurchases,
    ...winBackOffers,
    ...pricingAndAvailability,
    ...customerReviews,
    ...bundleIds,
    ...certificates,
    ...devices,
    ...profiles,
    ...merchantAndPassTypeIds,
    ...gameCenter,
    ...salesAndFinance,
    ...analytics,
    ...usersAndAccess,
    ...alternativeDistribution,
  };
};

export type AppStoreConnectApi = ReturnType<typeof makeAppStoreConnectApi>;
