import { describe, expect, test } from 'vitest';
import { findAppSkus, summarizeSalesLines } from './appStoreSalesReport.js';

const APP_ID = '6802289557';

const makeLine = (fields: Record<string, string>): Record<string, string> => ({
  'Apple Identifier': APP_ID,
  SKU: 'calfriend',
  'Parent Identifier': '',
  'Product Type Identifier': '1',
  Units: '1',
  'Developer Proceeds': '0',
  'Currency of Proceeds': 'USD',
  ...fields,
});

describe('findAppSkus', () => {
  test('collects the SKUs of the app only', () => {
    const skus = findAppSkus(
      [
        makeLine({ SKU: 'calfriend' }),
        makeLine({ 'Apple Identifier': '1', SKU: 'other' }),
        makeLine({ SKU: '' }),
      ],
      APP_ID,
    );

    expect([...skus]).toEqual(['calfriend']);
  });
});

describe('summarizeSalesLines', () => {
  const day = { date: '2026-10-20', storeId: APP_ID, appSkus: new Set(['calfriend']) };

  test('counts units per kind and sums proceeds per currency', () => {
    const stats = summarizeSalesLines(
      [
        makeLine({ Units: '3' }),
        makeLine({ 'Product Type Identifier': '3', Units: '2' }),
        makeLine({ 'Product Type Identifier': '7', Units: '5' }),
        makeLine({
          'Product Type Identifier': 'IA1',
          'Parent Identifier': 'calfriend',
          Units: '2',
          'Developer Proceeds': '2.1',
        }),
        makeLine({
          'Product Type Identifier': 'IA1',
          'Parent Identifier': 'calfriend',
          Units: '1',
          'Developer Proceeds': '3',
          'Currency of Proceeds': 'EUR',
        }),
      ],
      day,
    );

    expect(stats).toEqual([
      { date: '2026-10-20', feed: 'app-store', metric: 'downloads', value: 3, currency: null },
      { date: '2026-10-20', feed: 'app-store', metric: 'redownloads', value: 2, currency: null },
      { date: '2026-10-20', feed: 'app-store', metric: 'updates', value: 5, currency: null },
      { date: '2026-10-20', feed: 'app-store', metric: 'proceeds', value: 4.2, currency: 'USD' },
      { date: '2026-10-20', feed: 'app-store', metric: 'proceeds', value: 3, currency: 'EUR' },
    ]);
  });

  test('skips other apps, unknown product types and In-App Purchases of other apps', () => {
    const stats = summarizeSalesLines(
      [
        makeLine({ 'Apple Identifier': '1' }),
        makeLine({ 'Product Type Identifier': '1-B' }),
        makeLine({ 'Product Type Identifier': 'IA1', 'Parent Identifier': 'other', Units: '4' }),
      ],
      day,
    );

    expect(stats).toEqual([]);
  });

  test('nets a refund against its sale and skips zero proceeds', () => {
    const stats = summarizeSalesLines(
      [
        makeLine({
          'Product Type Identifier': 'IA1',
          'Parent Identifier': 'calfriend',
          Units: '1',
          'Developer Proceeds': '5',
        }),
        makeLine({
          'Product Type Identifier': 'IA1',
          'Parent Identifier': 'calfriend',
          Units: '-1',
          'Developer Proceeds': '5',
        }),
      ],
      day,
    );

    expect(stats).toEqual([]);
  });

  test('skips proceeds that have no currency', () => {
    const stats = summarizeSalesLines(
      [makeLine({ 'Developer Proceeds': '2', 'Currency of Proceeds': '' })],
      day,
    );

    expect(stats.map((stat) => stat.metric)).toEqual(['downloads']);
  });

  test('is empty for no lines', () => {
    expect(summarizeSalesLines([], day)).toEqual([]);
  });
});
