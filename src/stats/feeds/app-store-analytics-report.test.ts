import { describe, expect, test } from 'vitest';
import { summarizeAnalyticsBatches } from './app-store-analytics-report.ts';
import type { AnalyticsReportBatch } from './app-store-feed-types.ts';

const APP_ID = '6802289557';
const RANGE = { from: '2026-10-01', to: '2026-10-10' };

function makeBatch(fields: Partial<AnalyticsReportBatch>): AnalyticsReportBatch {
  return {
    kind: 'discovery',
    accessType: 'ONGOING',
    processingDate: '2026-10-11',
    lines: [],
    ...fields,
  };
}

function makeStat(date: string, metric: string, amount: number, currency: string | null = null) {
  return {
    date,
    feed: 'app-store',
    metric,
    value: amount,
    currency,
  };
}
function describeSummarizeAnalyticsBatches() {
  function sumsCountsPerDateOverTheAppRowsByEvent() {
    const batch = makeBatch({
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
    });
    const summary = summarizeAnalyticsBatches([batch], { storeId: APP_ID, range: RANGE });

    const stat = makeStat('2026-10-02', 'impressions', 15);
    expect(summary.stats).toEqual([stat, makeStat('2026-10-02', 'productPageViews', 4)]);
    expect(summary.latestDate).toBe('2026-10-02');
  }

  test('sums counts per date over the app rows by event', sumsCountsPerDateOverTheAppRowsByEvent);
  function readsDownloadsRedownloadsAndUpdatesByDownloadType() {
    const batch = makeBatch({
      kind: 'downloads',
      lines: [
        { Date: '2026-10-03', 'Download Type': 'First-time Download', Counts: '6' },
        { Date: '2026-10-03', 'Download Type': 'Redownload', Counts: '2' },
        { Date: '2026-10-03', 'Download Type': 'Restore', Counts: '1' },
        { Date: '2026-10-03', 'Download Type': 'Manual update', Counts: '3' },
        { Date: '2026-10-03', 'Download Type': 'Auto-update', Counts: '4' },
      ],
    });
    const summary = summarizeAnalyticsBatches([batch], { storeId: APP_ID, range: RANGE });

    const stat = makeStat('2026-10-03', 'downloads', 6);
    expect(summary.stats).toEqual([
      stat,
      makeStat('2026-10-03', 'redownloads', 3),
      makeStat('2026-10-03', 'updates', 7),
    ]);
  }

  test(
    'reads downloads, redownloads and updates by download type',
    readsDownloadsRedownloadsAndUpdatesByDownloadType,
  );
  function readsSessionsDevicesCrashesInstallsUninstallsAndUSDProceeds() {
    const batch = makeBatch({
      kind: 'sessions',
      lines: [{ Date: '2026-10-04', Sessions: '30', 'Unique Devices': '8' }],
    });
    const summary = summarizeAnalyticsBatches(
      [
        batch,
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

    const stat = makeStat('2026-10-04', 'sessions', 30);
    expect(summary.stats).toEqual([
      stat,
      makeStat('2026-10-04', 'activeDevices', 8),
      makeStat('2026-10-04', 'crashes', 2),
      makeStat('2026-10-04', 'installs', 5),
      makeStat('2026-10-04', 'uninstalls', 1),
      makeStat('2026-10-04', 'proceeds', 3.5, 'USD'),
    ]);
  }

  test(
    'reads sessions, devices, crashes, installs, uninstalls and USD proceeds',
    readsSessionsDevicesCrashesInstallsUninstallsAndUSDProceeds,
  );
  function dropsOtherAppsAndDatesOutsideTheRangeAndKeepsRowsWithoutAnAppId() {
    const batch = makeBatch({
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
    });
    const summary = summarizeAnalyticsBatches([batch], { storeId: APP_ID, range: RANGE });

    const stat = makeStat('2026-10-05', 'impressions', 3);
    expect(summary.stats).toEqual([stat]);
  }

  test(
    'drops other apps and dates outside the range, and keeps rows without an app id',
    dropsOtherAppsAndDatesOutsideTheRangeAndKeepsRowsWithoutAnAppId,
  );
  function letsALaterInstanceOverwriteAnEarlierOneForTheSameDateWithoutAddingThem() {
    const batch = makeBatch({
      processingDate: '2026-10-06',
      lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '10' }],
    });
    const summary = summarizeAnalyticsBatches(
      [
        batch,
        makeBatch({
          processingDate: '2026-10-07',
          lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '12' }],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    const stat = makeStat('2026-10-05', 'impressions', 12);
    expect(summary.stats).toEqual([stat]);
  }

  test(
    'lets a later instance overwrite an earlier one for the same date without adding them',
    letsALaterInstanceOverwriteAnEarlierOneForTheSameDateWithoutAddingThem,
  );
  function sumsTheSegmentsOfOneInstance() {
    const batch = makeBatch({ lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '10' }] });
    const summary = summarizeAnalyticsBatches(
      [batch, makeBatch({ lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '2' }] })],
      { storeId: APP_ID, range: RANGE },
    );

    const stat = makeStat('2026-10-05', 'impressions', 12);
    expect(summary.stats).toEqual([stat]);
  }

  test('sums the segments of one instance', sumsTheSegmentsOfOneInstance);
  function prefersOngoingPieceOverTheSnapshotAndFillsOlderDaysFromTheSnapshot() {
    const batch = makeBatch({
      accessType: 'ONE_TIME_SNAPSHOT',
      processingDate: '2026-10-20',
      lines: [
        { Date: '2026-10-02', Event: 'Impression', Counts: '1' },
        { Date: '2026-10-05', Event: 'Impression', Counts: '1' },
      ],
    });
    const summary = summarizeAnalyticsBatches(
      [
        batch,
        makeBatch({
          processingDate: '2026-10-08',
          lines: [{ Date: '2026-10-05', Event: 'Impression', Counts: '7' }],
        }),
      ],
      { storeId: APP_ID, range: RANGE },
    );

    const stat = makeStat('2026-10-02', 'impressions', 1);
    expect(summary.stats).toEqual([stat, makeStat('2026-10-05', 'impressions', 7)]);
    expect(summary.latestDate).toBe('2026-10-05');
  }

  test(
    'prefers ongoing data over the snapshot and fills older days from the snapshot',
    prefersOngoingPieceOverTheSnapshotAndFillsOlderDaysFromTheSnapshot,
  );
  function hasNoLatestDateWhenThereAreNoRows() {
    const summary = summarizeAnalyticsBatches([], { storeId: APP_ID, range: RANGE });

    expect(summary).toEqual({ stats: [], latestDate: null });
  }

  test('has no latest date when there are no rows', hasNoLatestDateWhenThereAreNoRows);
}

describe('summarizeAnalyticsBatches', describeSummarizeAnalyticsBatches);
