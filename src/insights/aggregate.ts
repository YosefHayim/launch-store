// Turns App Store Connect and Google Play reviews into ratings, sentiment, and a monthly trend.

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

/** Roll a set of reviews up into a {@link RatingSummary}. */
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

/** Build the chronological monthly trend */
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

  function readMonthAverage([month, { count, sum }]: [string, { count: number; sum: number }]) {
    return { month, count, average: round1(sum / count) };
  }

  return [...byMonth.entries()].sort(sortPiece).map(readMonthAverage);
}

/** Assemble one app's insights from its normalized reviews */
export function buildAppInsights(app: string, reviews: readonly ReviewDatum[]): AppInsights {
  const byStore: AppInsights['byStore'] = {};

  for (const store of ['appstore', 'play'] as const) {
    function isReviewForStore(review: {
      readonly store: InsightsStore;
      readonly rating: StarRating;
      readonly answered: boolean;
      readonly date?: string;
    }) {
      return review.store == store;
    }

    const subset = reviews.filter(isReviewForStore);

    if (subset.length > 0) byStore[store] = summarizeRatings(subset);
  }

  return {
    app,
    ratings: summarizeRatings(reviews),
    byStore,
    trend: monthlyTrend(reviews),
  };
}

/** Combine per-app insights into the full {@link InsightsReport} */
export function buildInsightsReport(
  perApp: readonly {
    app: string;
    reviews: readonly ReviewDatum[];
  }[],
): InsightsReport {
  function readAppInsights({ app, reviews }: { app: string; reviews: readonly ReviewDatum[] }) {
    return buildAppInsights(app, reviews);
  }

  function listReviews({ reviews }: { app: string; reviews: readonly ReviewDatum[] }) {
    return reviews;
  }

  return {
    apps: perApp.map(readAppInsights),
    overall: summarizeRatings(perApp.flatMap(listReviews)),
  };
}
/** Re-export so callers can iterate the canonical star order without re-declaring it. */
export { STARS };
