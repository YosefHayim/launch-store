// App Store customer reviews and developer responses.

/** One customer review of an app. */
export type CustomerReviewResource = Readonly<{
  id: string;
  rating: number;
  title?: string | undefined;
  body?: string | undefined;
  reviewerNickname?: string | undefined;
  territory?: string | undefined;
  createdDate?: string | undefined;
  answered: boolean;
}>;

/** A developer's response to a customer review - the editable, moderated reply shown under the review. */
export type CustomerReviewResponseResource = Readonly<{
  id: string;
  responseBody: string;
  state?: string | undefined;
  lastModifiedDate?: string | undefined;
}>;
