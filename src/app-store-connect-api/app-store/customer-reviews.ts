import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/customer-reviews
/**
 * One page of `/customerReviews`, fetched with `include=response` so each row's `relationships.response`
 * linkage is present - that's how {@link CustomerReviewResource.answered} is computed without a per-review
 * call. Kept separate from `PagedList` because `requestAll` drops
 * relationships, and the answered flag needs them.
 */
type CustomerReviewPage = {
  data: {
    id: string;
    attributes: {
      rating?: number;
      title?: string;
      body?: string;
      reviewerNickname?: string;
      territory?: string;
      createdDate?: string;
    };
    relationships?: {
      response?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};
/** Project an ASC `customerReviewResponses` resource object into a {@link CustomerReviewResponseResource}. */
const toReviewResponse = (appleResources: {
  id: string;
  attributes: {
    responseBody?: string;
    state?: string;
    lastModifiedDate?: string;
  };
}): CustomerReviewResponseResource => {
  let responseBody = appleResources.attributes.responseBody;
  if (responseBody === undefined) responseBody = '';
  const reviewResponse: CustomerReviewResponseResource = {
    id: appleResources.id,
    responseBody,
  };
  if (appleResources.attributes.state !== undefined)
    Object.assign(reviewResponse, { state: appleResources.attributes.state });
  if (appleResources.attributes.lastModifiedDate !== undefined)
    Object.assign(reviewResponse, { lastModifiedDate: appleResources.attributes.lastModifiedDate });
  return reviewResponse;
};
export const makeCustomerReviewsApi = (api: AppStoreConnectRequests) => {
  /**
   * List an app's customer reviews, newest first, across all pages. Fetched with `include=response`
   * so each row carries {@link CustomerReviewResource.answered} without a follow-up call;
   * `filter[rating]` / `filter[territory]` narrow server-side when provided.
   */
  const listCustomerReviews = async (
    appId: string,
    filters: {
      rating?: number;
      territory?: string;
    } = {},
  ): Promise<CustomerReviewResource[]> => {
    let path = `/apps/${appId}/customerReviews?include=response&sort=-createdDate&limit=200`;
    if (filters.rating !== undefined) path += `&filter[rating]=${filters.rating}`;
    if (filters.territory) path += `&filter[territory]=${encodeURIComponent(filters.territory)}`;
    const reviews: CustomerReviewResource[] = [];
    let next: string | undefined = path;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: CustomerReviewPage = await api.request<CustomerReviewPage>('GET', next);
      for (const { id, attributes, relationships } of page.data) {
        let rating = attributes.rating;
        if (typeof rating !== 'number') rating = 0;
        const customerReview: CustomerReviewResource = {
          id,
          rating,
          answered: Boolean(relationships?.response?.data),
        };
        if (attributes.title !== undefined)
          Object.assign(customerReview, { title: attributes.title });
        if (attributes.body !== undefined) Object.assign(customerReview, { body: attributes.body });
        if (attributes.reviewerNickname !== undefined)
          Object.assign(customerReview, { reviewerNickname: attributes.reviewerNickname });
        if (attributes.territory !== undefined)
          Object.assign(customerReview, { territory: attributes.territory });
        if (attributes.createdDate !== undefined)
          Object.assign(customerReview, { createdDate: attributes.createdDate });
        reviews.push(customerReview);
      }
      next = page.links?.next;
    }
    return reviews;
  };
  /** Read the developer response attached to a review, or null when none exists yet (Apple 404s on none). */
  const getCustomerReviewResponse = async (
    reviewId: string,
  ): Promise<CustomerReviewResponseResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
        data: {
          id: string;
          attributes: {
            responseBody?: string;
            state?: string;
            lastModifiedDate?: string;
          };
        } | null;
      }>('GET', `/customerReviews/${reviewId}/response`);
      if (appleResources === null) return null;
      return toReviewResponse(appleResources);
    });
  };
  /**
   * Create or replace the developer response to a review. Apple's `POST /v1/customerReviewResponses`
   * is an upsert - it replaces an existing response in place - so callers never delete-then-recreate.
   */
  const createCustomerReviewResponse = async (
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource> => {
    const appleResources = await api.createResource<{
      responseBody?: string;
      state?: string;
      lastModifiedDate?: string;
    }>('/customerReviewResponses', {
      type: 'customerReviewResponses',
      attributes: { responseBody },
      relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
    });
    return toReviewResponse(appleResources);
  };
  /** Delete a developer response by its resource id. */
  const deleteCustomerReviewResponse = async (responseId: string): Promise<void> => {
    await api.deleteResource(`/customerReviewResponses/${responseId}`);
  };
  return {
    listCustomerReviews,
    getCustomerReviewResponse,
    createCustomerReviewResponse,
    deleteCustomerReviewResponse,
  };
};
