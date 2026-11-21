import { describe, expect, test } from 'vitest';
import { summarizeAnalyticsBatches } from './appStoreAnalyticsReport.js';
import type { AnalyticsReportBatch } from './appStoreFeedTypes.js';

const APP_ID = '6802289557';
const RANGE = { from: '2026-10-01', to: '2026-10-10' };

const makeBatch = (fields: Partial<AnalyticsReportBatch>): AnalyticsReportBatch => ({
  kind: 'discovery',
  accessType: 'ONGOING',
  processingDate: '2026-10-11',
  lines: [],
  ...fields,
});

const makeStat = (
  date: string,
  metric: string,
  amount: number,
  currency: string | null = null,
) => ({
  date,
  feed: 'app-store',
  metric,
  value: amount,
  currency,
});

describe('summarizeAnalyticsBatches', () => {
  test('sums counts per date over the app rows by event', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          lines: [
            {
              Date: '2026-10-02',
              'App Apple Identifier': APP_ID,
              Event: 'Impression',
              Counts: '10',
            },
            {
              Date: '2026-10-02',
              'App Apple Identifier': APP_ID,
              Event: 'Impression',
              Counts: '5',
            },
            { Date: '2026-10-02', 'App Apple Identifier': APP_ID, Event: 'Page view', Counts: '4' },
            { Date: '2026-10-02', 'App Apple Identifier': APP_ID, Event: 'Tap', Counts: '9' },
          ],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([
      makeStat('2026-10-02', 'impressions', 15),
      makeStat('2026-10-02', 'productPageViews', 4),
    ]);
    expect(summary.latestDate).toBe('2026-10-02');
  });

  test('reads downloads, redownloads and updates by download type', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          kind: 'downloads',
          lines: [
            { Date: '2026-10-03', 'Download Type': 'First-time Download', Counts: '6' },
            { Date: '2026-10-03', 'Download Type': 'Redownload', Counts: '2' },
            { Date: '2026-10-03', 'Download Type': 'Restore', Counts: '1' },
            { Date: '2026-10-03', 'Download Type': 'Manual update', Counts: '3' },
            { Date: '2026-10-03', 'Download Type': 'Auto-update', Counts: '4' },
          ],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([
      makeStat('2026-10-03', 'downloads', 6),
      makeStat('2026-10-03', 'redownloads', 3),
      makeStat('2026-10-03', 'updates', 7),
    ]);
  });

  test('reads sessions, devices, crashes, installs, uninstalls and USD proceeds', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          kind: 'sessions',
          lines: [{ Date: '2026-10-04', Sessions: '30', 'Unique Devices': '8' }],
        }),
        makeBatch({ kind: 'crashes', lines: [{ Date: '2026-10-04', Crashes: '2' }] }),
        makeBatch({
          kind: 'installs',
          lines: [
            { Date: '2026-10-04', Event: 'Install', Counts: '5' },
            { Date: '2026-10-04', Event: 'Delete', Counts: '1' },
          ],
        }),
        makeBatch({
          kind: 'purchases',
          lines: [{ Date: '2026-10-04', Purchases: '2', 'Proceeds in USD': '3.5' }],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([
      makeStat('2026-10-04', 'sessions', 30),
      makeStat('2026-10-04', 'activeDevices', 8),
      makeStat('2026-10-04', 'crashes', 2),
      makeStat('2026-10-04', 'installs', 5),
      makeStat('2026-10-04', 'uninstalls', 1),
      makeStat('2026-10-04', 'proceeds', 3.5, 'USD'),
    ]);
  });

  test('drops other apps and dates outside the range, and keeps rows without an app id', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          lines: [
            { Date: '2026-10-05', 'App Apple Identifier': '1', Event: 'Impression', Counts: '99' },
            {
              Date: '2026-09-30',
              'App Apple Identifier': APP_ID,
              Event: 'Impression',
              Counts: '98',
            },
            {
              Date: '2026-10-11',
              'App Apple Identifier': APP_ID,
              Event: 'Impression',
              Counts: '97',
            },
            { Date: '2026-10-05', 'App Apple Identifier': '', Event: 'Impression', Counts: '3' },
          ],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([makeStat('2026-10-05', 'impressions', 3)]);
  });

  test('lets a later instance overwrite an earlier one for the same date without adding them', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          processingDate: '2026-10-06',
          lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '10' }],
        }),
        makeBatch({
          processingDate: '2026-10-07',
          lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '12' }],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([makeStat('2026-10-05', 'impressions', 12)]);
  });

  test('sums the segments of one instance', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({ lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '10' }] }),
        makeBatch({ lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '2' }] }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([makeStat('2026-10-05', 'impressions', 12)]);
  });

  test('prefers ongoing data over the snapshot and fills older days from the snapshot', () => {
    const summary = summarizeAnalyticsBatches(
      [
        makeBatch({
          accessType: 'ONE_TIME_SNAPSHOT',
          processingDate: '2026-10-20',
          lines: [
            { Date: '2026-10-02', Event: 'Impression', Counts: '1' },
            { Date: '2026-10-05', Event: 'Impression', Counts: '1' },
          ],
        }),
        makeBatch({
          processingDate: '2026-10-08',
          lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '7' }],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    expect(summary.stats).toEqual([
      makeStat('2026-10-02', 'impressions', 1),
      makeStat('2026-10-05', 'impressions', 7),
    ]);
    expect(summary.latestDate).toBe('2026-10-05');
  });

  test('has no latest date when there are no rows', () => {
    const summary = summarizeAnalyticsBatches([], { storeId: APP_ID, range: RANGE });

    expect(summary).toEqual({ stats: [], latestDate: null });
  });
});
