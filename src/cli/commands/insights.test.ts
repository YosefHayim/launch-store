import { describe, expect, it } from 'vitest';
import { renderInsights } from './insights.js';
import { buildInsightsReport } from '../../core/insights/aggregate.js';
import type { ReviewDatum } from '../../core/types.js';

/** Build a review datum with sensible defaults so tests state only what they exercise. */
function review(over: Partial<ReviewDatum> = {}): ReviewDatum {
  return { store: 'appstore', rating: 5, answered: false, ...over };
}

describe('renderInsights', () => {
  it('explains the empty case instead of rendering a blank block', () => {
    expect(renderInsights(buildInsightsReport([]))).toContain('No review data');
  });

  it('renders a headline, distribution bars, sentiment, and trend', () => {
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
    expect(out).toContain('Insights · 1 app · 3 reviews');
    expect(out).toContain('myapp');
    expect(out).toContain('★ 3.3 avg · 3 reviews · 33% answered');
    expect(out).toContain('sentiment: 2 positive · 0 neutral · 1 negative');
    expect(out).toContain('trend: 2026-05 4.5 (2) · 2026-06 1.0 (1)');
  });

  it('adds a per-store breakdown only when an app spans both stores', () => {
    const oneStore = renderInsights(
      buildInsightsReport([{ app: 'ios', reviews: [review({ store: 'appstore', rating: 5 })] }]),
    );
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
  });
});
