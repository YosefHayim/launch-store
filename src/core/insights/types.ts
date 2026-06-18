/**
 * Types for `launch insights` — the synthesis layer over the review/rating data Launch already pulls
 * via `reviews` and `play-reviews`. These describe the *aggregation result*, not a config or store
 * shape, so they live here beside the aggregator rather than in `core/types.ts` (the same call
 * `core/plan/types.ts` and `core/readiness/types.ts` make for their own feature vocabulary).
 *
 * Insights is read-only and informational: it never writes config or calls a mutating endpoint. The
 * shapes are intentionally store-agnostic — App Store and Play reviews are normalized to {@link ReviewDatum}
 * before aggregation so one set of summary functions serves both, and so a future source (e.g. parsed
 * sales/downloads) can extend the report without reworking the rating math.
 */

/** A star rating, constrained to the 1–5 range every store uses. */
export type StarRating = 1 | 2 | 3 | 4 | 5;

/** Which store a normalized review came from. */
export type InsightsStore = "appstore" | "play";

/**
 * Sentiment bucket derived purely from the star rating: 4–5 positive, 3 neutral, 1–2 negative. A
 * coarse proxy (Launch reads no review text into the model), but enough to surface ratings movement —
 * the dimension issue #178 calls out — without a new data source.
 */
export type Sentiment = "positive" | "neutral" | "negative";

/**
 * A review from either store reduced to exactly the fields insights aggregates over. The full review
 * bodies stay in `reviews list` / `play-reviews list`; insights only needs the rating, whether it was
 * answered, and when it landed (for the monthly trend).
 */
export interface ReviewDatum {
  /** The store this review came from, so per-store summaries can be split back out. */
  store: InsightsStore;
  /** Star rating 1–5. Reviews Apple/Play report with no rating are dropped before they reach here. */
  rating: StarRating;
  /** True when a developer response/reply is already attached. */
  answered: boolean;
  /** ISO-8601 timestamp the review was created (App Store) or last modified (Play); absent when unknown. */
  date?: string;
}

/**
 * The headline rollup over a set of reviews: count, mean rating, the per-star distribution, how many
 * carry a developer response, and the sentiment split. `average` and `answeredRate` are 0 for an empty
 * set so callers never divide by zero or branch on emptiness mid-render.
 */
export interface RatingSummary {
  /** Number of reviews in this set. */
  total: number;
  /** Mean star rating, rounded to one decimal; 0 when `total` is 0. */
  average: number;
  /** Count of reviews at each star level (keys "1".."5"); every key is present, 0 when none. */
  distribution: Record<StarRating, number>;
  /** How many reviews already have a developer response/reply. */
  answered: number;
  /** `answered / total` in the range 0–1; 0 when `total` is 0. */
  answeredRate: number;
  /** Sentiment split derived from the ratings; the three buckets sum to `total`. */
  sentiment: Record<Sentiment, number>;
}

/** One point on the monthly ratings trend: the calendar month plus the volume and mean for it. */
export interface MonthlyRatingPoint {
  /** Calendar month as `YYYY-MM`. */
  month: string;
  /** Reviews dated within this month. */
  count: number;
  /** Mean star rating for the month, rounded to one decimal. */
  average: number;
}

/**
 * Everything insights synthesizes for a single app: the combined rating summary, the same summary
 * split per store, and the chronological monthly trend. `byStore` omits a store the app doesn't target
 * or that returned no reviews, so the renderer shows only what's real.
 */
export interface AppInsights {
  /** The app handle (`AppDescriptor.name`). */
  app: string;
  /** Combined summary across every store this app reports on. */
  ratings: RatingSummary;
  /** Per-store summaries, present only for stores that yielded at least one review. */
  byStore: Partial<Record<InsightsStore, RatingSummary>>;
  /** Monthly rating points, oldest first; empty when no review carried a date. */
  trend: MonthlyRatingPoint[];
}

/**
 * The full insights report: one entry per app that yielded data, plus an `overall` summary across all
 * of them. This is the exact shape emitted by `--json`, so it doubles as the automation contract.
 */
export interface InsightsReport {
  /** Per-app insights, in the order the apps were selected. */
  apps: AppInsights[];
  /** Rating summary across every review from every app and store. */
  overall: RatingSummary;
}
