import type { BetaAppReviewSubmissionResource, BetaReviewState } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/beta-app-review-submissions
export const makeBetaAppReviewSubmissionsApi = (api: AppStoreConnectRequests) => {
  /** Read a build's Beta App Review submission (its current verdict), or null when it hasn't been submitted. */
  const getBetaAppReviewSubmission = async (
    buildId: string,
  ): Promise<BetaAppReviewSubmissionResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
        data: {
          id: string;
          attributes?: {
            betaReviewState?: BetaReviewState;
          };
        } | null;
      }>('GET', `/builds/${buildId}/betaAppReviewSubmission`);
      if (appleResources === null) return null;
      const reviewSubmission: BetaAppReviewSubmissionResource = { id: appleResources.id };
      if (appleResources.attributes?.betaReviewState !== undefined)
        Object.assign(reviewSubmission, { state: appleResources.attributes.betaReviewState });
      return reviewSubmission;
    });
  };
  /** Submit a build for Beta App Review (required before external testers can install it). */
  const createBetaAppReviewSubmission = async (buildId: string): Promise<void> => {
    await api.createResource('/betaAppReviewSubmissions', {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  };

  return {
    getBetaAppReviewSubmission,
    createBetaAppReviewSubmission,
  };
};
