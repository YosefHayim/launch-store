import { describe, expect, it } from "vitest";
import { buildAppInsights, buildInsightsReport, monthlyTrend, sentimentOf, summarizeRatings } from "./aggregate.js";
import type { ReviewDatum } from "./types.js";

/** Build a review datum with sensible defaults so tests state only what they exercise. */
function review(over: Partial<ReviewDatum> = {}): ReviewDatum {
  return { store: "appstore", rating: 5, answered: false, ...over };
}

describe("sentimentOf", () => {
  it("buckets 4–5 positive, 3 neutral, 1–2 negative", () => {
    expect(sentimentOf(5)).toBe("positive");
    expect(sentimentOf(4)).toBe("positive");
    expect(sentimentOf(3)).toBe("neutral");
    expect(sentimentOf(2)).toBe("negative");
    expect(sentimentOf(1)).toBe("negative");
  });
});

describe("summarizeRatings", () => {
  it("returns an all-zero summary for an empty set without dividing by zero", () => {
    expect(summarizeRatings([])).toEqual({
      total: 0,
      average: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      answered: 0,
      answeredRate: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 },
    });
  });

  it("tallies distribution, mean, answered rate, and sentiment in one pass", () => {
    const summary = summarizeRatings([
      review({ rating: 5, answered: true }),
      review({ rating: 5, answered: false }),
      review({ rating: 4, answered: true }),
      review({ rating: 3, answered: false }),
      review({ rating: 1, answered: false }),
    ]);
    expect(summary.total).toBe(5);
    expect(summary.average).toBe(3.6); // (5+5+4+3+1)/5 = 3.6
    expect(summary.distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 });
    expect(summary.answered).toBe(2);
    expect(summary.answeredRate).toBe(0.4);
    expect(summary.sentiment).toEqual({ positive: 3, neutral: 1, negative: 1 });
  });

  it("rounds the average to one decimal", () => {
    expect(summarizeRatings([review({ rating: 5 }), review({ rating: 4 }), review({ rating: 4 })]).average).toBe(4.3);
  });
});

describe("monthlyTrend", () => {
  it("groups dated reviews by YYYY-MM, oldest first, skipping undated ones", () => {
    const trend = monthlyTrend([
      review({ rating: 4, date: "2026-05-10T00:00:00Z" }),
      review({ rating: 2, date: "2026-05-20T00:00:00Z" }),
      review({ rating: 5, date: "2026-04-01T00:00:00Z" }),
      review({ rating: 5 }), // undated → excluded from the timeline
    ]);
    expect(trend).toEqual([
      { month: "2026-04", count: 1, average: 5 },
      { month: "2026-05", count: 2, average: 3 },
    ]);
  });
});

describe("buildAppInsights", () => {
  it("splits per-store summaries and only includes stores with reviews", () => {
    const insights = buildAppInsights("myapp", [
      review({ store: "appstore", rating: 5 }),
      review({ store: "appstore", rating: 3 }),
      review({ store: "play", rating: 4 }),
    ]);
    expect(insights.app).toBe("myapp");
    expect(insights.ratings.total).toBe(3);
    expect(insights.byStore.appstore?.total).toBe(2);
    expect(insights.byStore.play?.total).toBe(1);
  });

  it("omits a store the app left no reviews in", () => {
    const insights = buildAppInsights("ios-only", [review({ store: "appstore", rating: 5 })]);
    expect(insights.byStore.appstore).toBeDefined();
    expect(insights.byStore.play).toBeUndefined();
  });
});

describe("buildInsightsReport", () => {
  it("computes the overall summary across every app", () => {
    const report = buildInsightsReport([
      { app: "a", reviews: [review({ rating: 5 }), review({ rating: 5 })] },
      { app: "b", reviews: [review({ rating: 1 })] },
    ]);
    expect(report.apps.map((a) => a.app)).toEqual(["a", "b"]);
    expect(report.overall.total).toBe(3);
    expect(report.overall.average).toBe(3.7); // (5+5+1)/3 = 3.666… → 3.7
  });
});
