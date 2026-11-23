import type {
  AppInsights,
  InsightsReport,
  MonthlyRatingPoint,
  RatingSummary,
  ReviewDatum,
  Sentiment,
  StarRating,
} from '../types/insights.ts';
import type { InsightsStore } from '../types/insights.ts';

/** The star levels, fixed so the distribution always has all five keys (even at zero). */
const STARS: readonly StarRating[] = [1, 2, 3, 4, 5];
/** Round to one decimal place - the precision both the average rating and the trend report at. */
function round1(numericAmount: number): number {
  return Math.round(numericAmount * 10) / 10;
}
/** Map a star rating to its sentiment bucket: 4-5 positive, 3 neutral, 1-2 negative. */
export function sentimentOf(rating: StarRating): Sentiment {
  if (rating >= 4) return 'positive';
  if (rating == 3) return 'neutral';
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
  let average = 0;
  let answeredRate = 0;
  if (total > 0) {
    average = round1(ratingSum / total);
    answeredRate = answered / total;
  }
  return {
    total,
    average,
    distribution,
    answered,
    // Keep the rate at full precision for `--json`; the renderer rounds it to a whole percent.
    answeredRate,
    sentiment,
  };
}
/**
 * Build the chronological monthly trend: group dated reviews by `YYYY-MM`, then report each month's
 * volume and mean rating, oldest first. Reviews with no date are skipped (they can't be placed on a
 * timeline) - so a trend can be shorter than the review count, by design.
 */
export function monthlyTrend(reviews: readonly ReviewDatum[]): MonthlyRatingPoint[] {
  const byMonth = new Map<
    string,
    {
      count: number;
      sum: number;
    }
  >();
  for (const review of reviews) {
    if (!review.date) continue;
    const month = review.date.slice(0, 7); // "YYYY-MM" from an ISO-8601 timestamp
    let bucket = byMonth.get(month);
    if (bucket == null) bucket = { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += review.rating;
    byMonth.set(month, bucket);
  }
  function sortPiece(
    [a]: [string, { count: number; sum: number }],
    [b]: [string, { count: number; sum: number }],
  ) {
    return a.localeCompare(b);
  }

  function mapPiece([month, { count, sum }]: [string, { count: number; sum: number }]) {
    return { month, count, average: round1(sum / count) };
  }

  return [...byMonth.entries()].sort(sortPiece).map(mapPiece);
}
/**
 * Assemble one app's insights from its normalized reviews: the combined summary, a per-store summary
 * for each store that returned at least one review, and the monthly trend across all of them.
 */
export function buildAppInsights(app: string, reviews: readonly ReviewDatum[]): AppInsights {
  const byStore: AppInsights['byStore'] = {};
  for (const store of ['appstore', 'play'] as const) {
    function filterReview(review: {
      readonly store: InsightsStore;
      readonly rating: StarRating;
      readonly answered: boolean;
      readonly date?: string;
    }) {
      return review.store == store;
    }

    const subset = reviews.filter(filterReview);
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
  perApp: readonly {
    app: string;
    reviews: readonly ReviewDatum[];
  }[],
): InsightsReport {
  function mapPiece2({ app, reviews }: { app: string; reviews: readonly ReviewDatum[] }) {
    return buildAppInsights(app, reviews);
  }

  function flatMapPiece({ reviews }: { app: string; reviews: readonly ReviewDatum[] }) {
    return reviews;
  }

  return {
    apps: perApp.map(mapPiece2),
    overall: summarizeRatings(perApp.flatMap(flatMapPiece)),
  };
}
/** Re-export so callers can iterate the canonical star order without re-declaring it. */
export { STARS };
