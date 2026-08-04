export type StarRating = 1 | 2 | 3 | 4 | 5;
/** Which store a normalized review came from. */
export type InsightsStore = 'appstore' | 'play';
/**
 * Sentiment bucket derived purely from the star rating: 4-5 positive, 3 neutral, 1-2 negative. A
 * coarse proxy (Launch reads no review text into the model), but enough to surface ratings movement -
 * the dimension issue #178 calls out - without a new data source.
 */
export type Sentiment = 'positive' | 'neutral' | 'negative';
/**
 * A review from either store reduced to exactly the fields insights aggregates over. The full review
 * bodies stay in `reviews list` / `play-reviews list`; insights only needs the rating, whether it was
 * answered, and when it landed (for the monthly trend).
 */
export type ReviewDatum = {
  store: InsightsStore;
  rating: StarRating;
  answered: boolean;
  date?: string;
};
/**
 * The headline rollup over a set of reviews: count, mean rating, the per-star distribution, how many
 * carry a developer response, and the sentiment split. `average` and `answeredRate` are 0 for an empty
 * set so callers never divide by zero or branch on emptiness mid-render.
 */
export type RatingSummary = {
  total: number;
  average: number;
  distribution: Record<StarRating, number>;
  answered: number;
  answeredRate: number;
  sentiment: Record<Sentiment, number>;
};
/** One point on the monthly ratings trend: the calendar month plus the volume and mean for it. */
export type MonthlyRatingPoint = {
  month: string;
  count: number;
  average: number;
};
/**
 * Everything insights synthesizes for a single app: the combined rating summary, the same summary
 * split per store, and the chronological monthly trend. `byStore` omits a store the app doesn't target
 * or that returned no reviews, so the renderer shows only what's real.
 */
export type AppInsights = {
  app: string;
  ratings: RatingSummary;
  byStore: Partial<Record<InsightsStore, RatingSummary>>;
  trend: MonthlyRatingPoint[];
};
/**
 * The full insights report: one entry per app that yielded data, plus an `overall` summary across all
 * of them. This is the exact shape emitted by `--json`, so it doubles as the automation contract.
 */
export type InsightsReport = {
  apps: AppInsights[];
  overall: RatingSummary;
};
