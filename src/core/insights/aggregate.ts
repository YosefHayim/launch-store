/**
 * The pure aggregation behind `launch insights`: turn a flat list of normalized {@link ReviewDatum}
 * into the per-app and overall {@link RatingSummary} / trend the command renders. No I/O, no clients —
 * the command pulls the live reviews and maps them to `ReviewDatum`; everything numeric lives here so
 * it's unit-testable without a network or an account.
 */

import type {
  AppInsights,
  InsightsReport,
  MonthlyRatingPoint,
  RatingSummary,
  ReviewDatum,
  Sentiment,
  StarRating,
} from './types.js';

/** The star levels, fixed so the distribution always has all five keys (even at zero). */
const STARS: readonly StarRating[] = [1, 2, 3, 4, 5];

/** Round to one decimal place — the precision both the average rating and the trend report at. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Map a star rating to its sentiment bucket: 4–5 positive, 3 neutral, 1–2 negative. */
export function sentimentOf(rating: StarRating): Sentiment {
  if (rating >= 4) return 'positive';
  if (rating === 3) return 'neutral';
  return 'negative';
}

/**
 * Roll a set of reviews up into a {@link RatingSummary}. Single pass: tallies the distribution,
 * answered count, and sentiment split, then derives the mean and answered rate. An empty set yields an
 * all-zero summary (average 0, rates 0) so callers render it without special-casing emptiness.
 */
export function summarizeRatings(reviews: readonly ReviewDatum[]): RatingSummary {
  const distribution: Record<StarRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const sentiment: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  let ratingSum = 0;
  let answered = 0;

  for (const review of reviews) {
    distribution[review.rating] += 1;
    sentiment[sentimentOf(review.rating)] += 1;
    ratingSum += review.rating;
    if (review.answered) answered += 1;
  }

  const total = reviews.length;
  return {
    total,
    average: total === 0 ? 0 : round1(ratingSum / total),
    distribution,
    answered,
    // Keep the rate at full precision for `--json`; the renderer rounds it to a whole percent.
    answeredRate: total === 0 ? 0 : answered / total,
    sentiment,
  };
}

/**
 * Build the chronological monthly trend: group dated reviews by `YYYY-MM`, then report each month's
 * volume and mean rating, oldest first. Reviews with no date are skipped (they can't be placed on a
 * timeline) — so a trend can be shorter than the review count, by design.
 */
export function monthlyTrend(reviews: readonly ReviewDatum[]): MonthlyRatingPoint[] {
  const byMonth = new Map<string, { count: number; sum: number }>();
  for (const review of reviews) {
    if (!review.date) continue;
    const month = review.date.slice(0, 7); // "YYYY-MM" from an ISO-8601 timestamp
    const bucket = byMonth.get(month) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += review.rating;
    byMonth.set(month, bucket);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { count, sum }]) => ({ month, count, average: round1(sum / count) }));
}

/**
 * Assemble one app's insights from its normalized reviews: the combined summary, a per-store summary
 * for each store that returned at least one review, and the monthly trend across all of them.
 */
export function buildAppInsights(app: string, reviews: readonly ReviewDatum[]): AppInsights {
  const byStore: AppInsights['byStore'] = {};
  for (const store of ['appstore', 'play'] as const) {
    const subset = reviews.filter((review) => review.store === store);
    if (subset.length > 0) byStore[store] = summarizeRatings(subset);
  }

  return {
    app,
    ratings: summarizeRatings(reviews),
    byStore,
    trend: monthlyTrend(reviews),
  };
}

/**
 * Combine per-app insights into the full {@link InsightsReport}, computing the `overall` summary from
 * every app's reviews at once. Takes the apps already paired with their reviews so the command stays
 * the only place that touches the network.
 */
export function buildInsightsReport(
  perApp: readonly { app: string; reviews: readonly ReviewDatum[] }[],
): InsightsReport {
  return {
    apps: perApp.map(({ app, reviews }) => buildAppInsights(app, reviews)),
    overall: summarizeRatings(perApp.flatMap(({ reviews }) => reviews)),
  };
}

/** Re-export so callers can iterate the canonical star order without re-declaring it. */
export { STARS };
