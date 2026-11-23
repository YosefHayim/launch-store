export type StarRating = 1 | 2 | 3 | 4 | 5;

/** Which store a normalized review came from. */
export type InsightsStore = 'appstore' | 'play';

/** Sentiment bucket derived purely from the star rating: 4-5 positive, 3 neutral, 1-2 negative. */
export type Sentiment = 'positive' | 'neutral' | 'negative';

/** A review from either store reduced to exactly the fields insights aggregates over. */
export type ReviewDatum = Readonly<{
  store: InsightsStore;
  rating: StarRating;
  answered: boolean;
  date?: string;
}>;

/** The headline rollup over a set of reviews */
export type RatingSummary = Readonly<{
  total: number;
  average: number;
  distribution: Record<StarRating, number>;
  answered: number;
  answeredRate: number;
  sentiment: Record<Sentiment, number>;
}>;

/** One point on the monthly ratings trend: the calendar month plus the volume and mean for it. */
export type MonthlyRatingPoint = Readonly<{
  month: string;
  count: number;
  average: number;
}>;

/** Everything insights synthesizes for a single app */
export type AppInsights = Readonly<{
  app: string;
  ratings: RatingSummary;
  byStore: Partial<Record<InsightsStore, RatingSummary>>;
  trend: readonly MonthlyRatingPoint[];
}>;

/** The full insights report */
export type InsightsReport = Readonly<{
  apps: readonly AppInsights[];
  overall: RatingSummary;
}>;
