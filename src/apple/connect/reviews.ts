import type { AscHost } from './host.ts';
import type { CustomerReviewPage } from './shared.ts';
import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '@/types/apple-catalog.js';
import { readReviewResponse } from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectReviews {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of customer reviews for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-customerreviews
   */
  async listCustomerReviews(
    appId: string,
    filters: {
      rating?: number;
      territory?: string;
    } = {},
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomerReviewResource[]> {
    let path = applyAppleListQuery(`/apps/${appId}/customerReviews`, listQuery, APPLE_PAGE_LIMIT, {
      include: 'response',
      sort: '-createdDate',
    });

    if (filters.rating != null) path += `&filter[rating]=${filters.rating}`;

    if (filters.territory) path += `&filter[territory]=${encodeURIComponent(filters.territory)}`;

    const reviews: CustomerReviewResource[] = [];
    let next: string | undefined = path;

    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: CustomerReviewPage = await this.client.request<CustomerReviewPage>('GET', next);

      for (const { id, attributes, relationships } of page.data) {
        let rating = attributes.rating;

        if (typeof rating != 'number') rating = 0;

        const customerReview: CustomerReviewResource = {
          id,
          rating,
          answered: Boolean(relationships?.response?.data),
        };

        if (attributes.title != null) Object.assign(customerReview, { title: attributes.title });

        if (attributes.body != null) Object.assign(customerReview, { body: attributes.body });

        if (attributes.reviewerNickname != null)
          Object.assign(customerReview, { reviewerNickname: attributes.reviewerNickname });

        if (attributes.territory != null)
          Object.assign(customerReview, { territory: attributes.territory });

        if (attributes.createdDate != null)
          Object.assign(customerReview, { createdDate: attributes.createdDate });

        reviews.push(customerReview);
      }

      next = page.links?.next;
    }

    return reviews;
  }

  /**
   * Get the response to a specific customer review.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-customerreviews-_id_-response
   */
  async getCustomerReviewResponse(
    reviewId: string,
  ): Promise<CustomerReviewResponseResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes: {
            responseBody?: string;
            state?: string;
            lastModifiedDate?: string;
          };
        } | null;
      }>('GET', `/customerReviews/${reviewId}/response`);

      if (appleResources == null) return null;

      return readReviewResponse(appleResources);
    });
  }

  /**
   * Create a response or replace an existing response you wrote to a customer review.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-customerreviewresponses
   */
  async createCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource> {
    const appleResources = await this.client.createResource<{
      responseBody?: string;
      state?: string;
      lastModifiedDate?: string;
    }>('/customerReviewResponses', {
      type: 'customerReviewResponses',
      attributes: { responseBody },
      relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
    });

    return readReviewResponse(appleResources);
  }

  /**
   * Delete a specific response you wrote to a customer review.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-customerreviewresponses-_id_
   */
  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    await this.client.deleteResource(`/customerReviewResponses/${responseId}`);
  }
}
