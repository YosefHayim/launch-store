import { describe, expect, test } from 'vitest';
import type { AppStatsReport, StatsReport } from '../types/statsReport.js';
import { createAppsTabHtml } from './appsTabHtml.js';

const appReport = (overrides: Partial<AppStatsReport>): AppStatsReport => ({
  key: 'ios-1',
  name: 'Cal Friend AI',
  platform: 'ios',
  owner: 'mine',
  accountLabel: 'alpha',
  totals: [
    {
      feed: 'app-store',
      metric: 'downloads',
      currency: null,
      aggregation: 'sum',
      total: 15,
      dayCount: 3,
    },
    {
      feed: 'app-store',
      metric: 'proceeds',
      currency: 'USD',
      aggregation: 'sum',
      total: 3,
      dayCount: 1,
    },
    { feed: 'ga4', metric: 'sessions', currency: null, aggregation: 'sum', total: 80, dayCount: 3 },
  ],
  series: [
    {
      feed: 'app-store',
      metric: 'downloads',
      currency: null,
      points: [
        { date: '2026-10-01', amount: 4 },
        { date: '2026-10-02', amount: 5 },
        { date: '2026-10-03', amount: 6 },
      ],
    },
    {
      feed: 'ga4',
      metric: 'sessions',
      currency: null,
      points: [
        { date: '2026-10-01', amount: 30 },
        { date: '2026-10-02', amount: 30 },
        { date: '2026-10-03', amount: 20 },
      ],
    },
  ],
  isStale: false,
  messages: [],
  ...overrides,
});

const report = (overrides: Partial<StatsReport>): StatsReport => ({
  range: { from: '2026-10-01', to: '2026-10-03' },
  days: 3,
  isStale: false,
  apps: [appReport({})],
  ...overrides,
});

describe('createAppsTabHtml', () => {
  test('draws a titled sparkline and bar chart with no script and a table fallback', () => {
    const html = createAppsTabHtml(report({}));

    expect(html).toContain('<polyline class="spark"');
    expect(html).toContain('<title>Downloads per day for Cal Friend AI, last 3 days</title>');
    expect(html).toContain('<title>Downloads per app in the chosen range</title>');
    expect(html).toContain('Downloads per app as a table');
    expect(html).toContain('Daily numbers for Cal Friend AI');
    expect(html).toContain('USD 3.00');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('Some numbers are old');
  });

  test('escapes app names and messages from untrusted sources', () => {
    const html = createAppsTabHtml(
      report({
        isStale: true,
        apps: [appReport({ name: '<img src=x onerror=alert(1)>', messages: ['<b>oops</b>'] })],
      }),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;oops&lt;/b&gt;');
  });

  test('shows a stale banner, with a message list only when there are messages', () => {
    const staleWithoutMessages = createAppsTabHtml(report({ isStale: true }));
    const staleWithMessages = createAppsTabHtml(
      report({ isStale: true, apps: [appReport({ messages: ['app-store: report not ready'] })] }),
    );

    expect(staleWithoutMessages).toContain('class="warn"');
    expect(staleWithoutMessages).not.toContain('<ul>');
    expect(staleWithMessages).toContain('<li>app-store: report not ready</li>');
  });

  test('says there are no apps when the report is empty', () => {
    const html = createAppsTabHtml(report({ apps: [] }));

    expect(html).toContain('No apps found.');
    expect(html).not.toContain('<polyline');
  });

  test('shows dashes and skips the sparkline for an app with one day or no numbers', () => {
    const html = createAppsTabHtml(
      report({
        apps: [
          appReport({
            owner: null,
            totals: [],
            series: [
              {
                feed: 'app-store',
                metric: 'downloads',
                currency: null,
                points: [{ date: '2026-10-01', amount: 4 }],
              },
            ],
          }),
        ],
      }),
    );

    expect(html).not.toContain('<polyline');
    expect(html).toContain('untagged');
    expect(html).toContain('<span class="muted">-</span>');
  });

  test('draws a flat sparkline when every day has the same amount', () => {
    const flatSeries = [
      {
        feed: 'app-store' as const,
        metric: 'downloads' as const,
        currency: null,
        points: [
          { date: '2026-10-01', amount: 2 },
          { date: '2026-10-02', amount: 2 },
        ],
      },
    ];

    const html = createAppsTabHtml(report({ apps: [appReport({ series: flatSeries })] }));

    expect(html).toContain('<polyline class="spark" points="3.0,16.0 137.0,16.0"');
  });
});
