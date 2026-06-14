/**
 * The `launch reviews` domain: read an app's customer reviews and manage the developer response,
 * entirely through the App Store Connect API key (no portal, no web session).
 *
 * Design:
 * - **Stateless & read-first.** Every call reads the live account; there's no local cache to drift.
 *   `listReviews` resolves the app record from its bundle id, pulls all pages, and applies the
 *   rating / territory / unanswered filters; unanswered is computed client-side from each review's
 *   `answered` flag (derived from the `response` relationship the client already includes).
 * - **One write path, made safe.** A developer response is a public, moderated reply, so the command
 *   confirms before posting. Apple's `POST /v1/customerReviewResponses` is an upsert (it replaces an
 *   existing reply in place), so {@link replyToReview} reports whether it *replaced* one — letting the
 *   command warn "this overwrites your current reply" — without a delete-then-recreate dance.
 *
 * The {@link AscReviewsApi} slice mirrors `core/ascSync.ts`'s `AscCatalogApi`: it names the exact
 * client surface this module needs, so the logic is unit-testable with a hand-rolled fake and
 * `AppStoreConnectClient` satisfies it structurally.
 */

import type { CustomerReviewResource, CustomerReviewResponseResource } from "../apple/ascClient.js";

/** The exact slice of {@link AppStoreConnectClient} the reviews domain depends on. */
export interface AscReviewsApi {
  getAppId(bundleId: string): Promise<string | null>;
  listCustomerReviews(
    appId: string,
    filters: { rating?: number; territory?: string },
  ): Promise<CustomerReviewResource[]>;
  getCustomerReviewResponse(reviewId: string): Promise<CustomerReviewResponseResource | null>;
  createCustomerReviewResponse(reviewId: string, responseBody: string): Promise<CustomerReviewResponseResource>;
  deleteCustomerReviewResponse(responseId: string): Promise<void>;
}

/** Filters for {@link listReviews}. `unansweredOnly` is applied client-side; the rest narrow server-side. */
export interface ReviewFilters {
  /** Keep only this star rating (1–5). */
  rating?: number;
  /** Keep only reviews from this territory (e.g. `USA`). */
  territory?: string;
  /** Keep only reviews without a developer response yet. */
  unansweredOnly?: boolean;
}

/** Outcome of {@link replyToReview}: the stored response and whether it replaced an existing reply. */
export interface ReplyResult {
  response: CustomerReviewResponseResource;
  /** True when a prior response existed and this call overwrote it (Apple's POST is an upsert). */
  replaced: boolean;
}

/** The "no app record" guidance shared by every reviews/reports entry point that resolves a bundle id. */
function appRecordMissing(bundleId: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this account ` +
      `can access the app (Apple has no API to create an app record — it's created once in App Store Connect).`,
  );
}

/**
 * List an app's customer reviews (newest first), narrowed by the given filters. Resolves the ASC app
 * record from the bundle id first, throwing an actionable error when none exists. Rating and territory
 * are pushed to Apple; `unansweredOnly` is applied here over the `answered` flag each review carries.
 */
export async function listReviews(
  api: AscReviewsApi,
  bundleId: string,
  filters: ReviewFilters = {},
): Promise<CustomerReviewResource[]> {
  const appId = await api.getAppId(bundleId);
  if (!appId) throw appRecordMissing(bundleId);

  const serverFilters: { rating?: number; territory?: string } = {};
  if (filters.rating !== undefined) serverFilters.rating = filters.rating;
  if (filters.territory) serverFilters.territory = filters.territory;

  const reviews = await api.listCustomerReviews(appId, serverFilters);
  return filters.unansweredOnly ? reviews.filter((review) => !review.answered) : reviews;
}

/**
 * Post (or replace) the developer response to a review. Checks for an existing reply first only to
 * report `replaced` so the command can warn before overwriting; the write itself is one upsert POST.
 */
export async function replyToReview(api: AscReviewsApi, reviewId: string, responseBody: string): Promise<ReplyResult> {
  const existing = await api.getCustomerReviewResponse(reviewId);
  const response = await api.createCustomerReviewResponse(reviewId, responseBody);
  return { response, replaced: existing !== null };
}

/**
 * Delete the developer response to a review, returning whether there was one to delete. Resolves the
 * response's resource id from the review (the delete endpoint keys on the response id, not the review).
 */
export async function deleteReviewResponse(api: AscReviewsApi, reviewId: string): Promise<boolean> {
  const existing = await api.getCustomerReviewResponse(reviewId);
  if (!existing) return false;
  await api.deleteCustomerReviewResponse(existing.id);
  return true;
}
