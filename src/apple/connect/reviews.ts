import type { AscHost } from './host.ts';
import type { CustomerReviewPage } from './shared.ts';
import type {
  CustomerReviewResource,
  CustomerReviewResponseResource,
} from '../../types/appleCatalog.ts';
import { toReviewResponse } from './shared.ts';

export class ConnectReviews {
  constructor(private readonly client: AscHost) {}

  async listCustomerReviews(
    appId: string,
    filters: {
      rating?: number;
      territory?: string;
    } = {},
  ): Promise<CustomerReviewResource[]> {
    let path = `/apps/${appId}/customerReviews?include=response&sort=-createdDate&limit=200`;
    if (filters.rating !== undefined) path += `&filter[rating]=${filters.rating}`;
    if (filters.territory) path += `&filter[territory]=${encodeURIComponent(filters.territory)}`;
    const reviews: CustomerReviewResource[] = [];
    let next: string | undefined = path;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: CustomerReviewPage = await this.client.request<CustomerReviewPage>('GET', next);
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
  }

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
      if (appleResources === null) return null;
      return toReviewResponse(appleResources);
    });
  }

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
    return toReviewResponse(appleResources);
  }

  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    await this.client.deleteResource(`/customerReviewResponses/${responseId}`);
  }
}
