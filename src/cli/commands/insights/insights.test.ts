import { describe, expect, it } from 'vitest';
import { buildInsightsReport } from '../../../insights/aggregate.ts';
import { renderInsights } from '../../../insights/command.ts';
import type { ReviewDatum } from '../../../types/insights.ts';

/** Build a review datum with sensible defaults so tests state only what they exercise. */
function review(over: Partial<ReviewDatum> = {}): ReviewDatum {
  return { store: 'appstore', rating: 5, answered: false, ...over };
}

function describeRenderInsights() {
  function explainsTheEmptyCaseInsteadOfRenderingABlankBlock() {
    const insightsReport = buildInsightsReport([]);
    const insights = renderInsights(insightsReport);
    expect(insights).toContain('No review data');
  }

  it(
    'explains the empty case instead of rendering a blank block',
    explainsTheEmptyCaseInsteadOfRenderingABlankBlock,
  );

  function rendersAHeadlineDistributionBarsSentimentAndTrend() {
    const report = buildInsightsReport([
      {
        app: 'myapp',
        reviews: [
          review({ rating: 5, answered: true, date: '2026-05-02T00:00:00Z' }),
          review({ rating: 4, date: '2026-05-09T00:00:00Z' }),
          review({ rating: 1, date: '2026-06-01T00:00:00Z' }),
        ],
      },
    ]);
    const out = renderInsights(report);

    expect(out).toContain('Insights - 1 app - 3 reviews');
    expect(out).toContain('myapp');
    expect(out).toContain('Rating 3.3/5 - 3 reviews - 33% answered');
    expect(out).toContain('sentiment: 2 positive - 0 neutral - 1 negative');
    expect(out).toContain('trend: 2026-05 4.5 (2) - 2026-06 1.0 (1)');
  }

  it(
    'renders a headline, distribution bars, sentiment, and trend',
    rendersAHeadlineDistributionBarsSentimentAndTrend,
  );

  function addsAPerStoreBreakdownOnlyWhenAnAppSpansBothStores() {
    const insightsReport = buildInsightsReport([
      { app: 'ios', reviews: [review({ store: 'appstore', rating: 5 })] },
    ]);
    const oneStore = renderInsights(insightsReport);

    expect(oneStore).not.toContain('App Store:');

    const bothStores = renderInsights(
      buildInsightsReport([
        {
          app: 'both',
          reviews: [review({ store: 'appstore', rating: 5 }), review({ store: 'play', rating: 3 })],
        },
      ]),
    );

    expect(bothStores).toContain('App Store:');
    expect(bothStores).toContain('Play:');
  }

  it(
    'adds a per-store breakdown only when an app spans both stores',
    addsAPerStoreBreakdownOnlyWhenAnAppSpansBothStores,
  );
}

describe('renderInsights', describeRenderInsights);
