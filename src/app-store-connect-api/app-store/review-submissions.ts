import type {
  AppStoreReviewDetailResource,
  ReviewSubmissionResource,
} from '@core/types/appleCatalog.js';
import type {
  AppStoreConnectRequests,
  ResourceSingle,
} from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/review-submissions
export const makeReviewSubmissionsApi = (api: AppStoreConnectRequests) => {
  /** Read a version's App Review details (contact info; never the demo password), or null when unset. */
  const getAppStoreReviewDetail = async (
    versionId: string,
  ): Promise<AppStoreReviewDetailResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
        data: {
          id: string;
          attributes?: Record<string, string | boolean>;
        } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreReviewDetail`);
      if (appleResources === null) return null;
      let reviewAttributes = appleResources.attributes;
      if (reviewAttributes === undefined) reviewAttributes = {};
      return { id: appleResources.id, attributes: reviewAttributes };
    });
  };
  /** Create a version's App Review details from the given attributes. */
  const createAppStoreReviewDetail = async (
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{
    id: string;
  }> => {
    const appleResources = await api.createResource('/appStoreReviewDetails', {
      type: 'appStoreReviewDetails',
      attributes,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return { id: appleResources.id };
  };
  /** Update a version's existing App Review details (only the supplied attributes change). */
  const updateAppStoreReviewDetail = async (
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void> => {
    await api.updateResource(`/appStoreReviewDetails/${detailId}`, {
      type: 'appStoreReviewDetails',
      id: detailId,
      attributes,
    });
  };
  /** List an app's review submissions for a platform (to reuse an addable `READY_FOR_REVIEW` draft). */
  const listReviewSubmissions = async (
    appId: string,
    platform: string,
  ): Promise<ReviewSubmissionResource[]> => {
    const appleResources = await api.requestAll<{
      state?: string;
    }>(
      `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}&limit=200&fields[reviewSubmissions]=state`,
    );
    return appleResources.map((submission) => {
      let state = submission.attributes.state;
      if (state === undefined) state = '';
      return { id: submission.id, state };
    });
  };
  /** Open a new review submission container for a platform. */
  const createReviewSubmission = async (
    appId: string,
    platform: string,
  ): Promise<ReviewSubmissionResource> => {
    const appleResources = await api.createResource<{
      state?: string;
    }>('/reviewSubmissions', {
      type: 'reviewSubmissions',
      attributes: { platform },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let state = appleResources.attributes.state;
    if (state === undefined) state = '';
    return { id: appleResources.id, state };
  };
  /** Add a version to a review submission as an item (required before the submission can be submitted). */
  const addReviewSubmissionItem = async (
    submissionId: string,
    versionId: string,
  ): Promise<void> => {
    await api.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    });
  };
  /** Add a product-page experiment to a review submission as an item. */
  const addExperimentReviewSubmissionItem = async (
    submissionId: string,
    experimentId: string,
  ): Promise<void> => {
    await api.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersionExperimentV2: {
          data: { type: 'appStoreVersionExperiments', id: experimentId },
        },
      },
    });
  };
  /** Submit a review submission to Apple (the `submitted: true` PATCH). */
  const submitReviewSubmission = async (submissionId: string): Promise<void> => {
    await api.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    });
  };
  /** Cancel a review submission - the hotfix-loop withdraw that frees the version to be edited again. */
  const cancelReviewSubmission = async (submissionId: string): Promise<void> => {
    await api.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { canceled: true },
    });
  };
  /** Read one review submission's current state (for `launch status`). */
  const getReviewSubmission = async (submissionId: string): Promise<ReviewSubmissionResource> => {
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        state?: string;
      }>
    >('GET', `/reviewSubmissions/${submissionId}?fields[reviewSubmissions]=state`);
    let state = appleResources.attributes.state;
    if (state === undefined) state = '';
    return { id: appleResources.id, state };
  };

  return {
    getAppStoreReviewDetail,
    createAppStoreReviewDetail,
    updateAppStoreReviewDetail,
    listReviewSubmissions,
    createReviewSubmission,
    addReviewSubmissionItem,
    addExperimentReviewSubmissionItem,
    submitReviewSubmission,
    cancelReviewSubmission,
    getReviewSubmission,
  };
};
