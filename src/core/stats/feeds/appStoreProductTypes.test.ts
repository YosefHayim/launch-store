import { describe, expect, test } from 'vitest';
import { findSalesReportKind } from './appStoreProductTypes.js';

describe('findSalesReportKind', () => {
  test('reads first-time download ids as downloads', () => {
    expect(findSalesReportKind('1')).toBe('download');
    expect(findSalesReportKind('F1')).toBe('download');
  });

  test('reads re-download ids as redownloads', () => {
    expect(findSalesReportKind('3')).toBe('redownload');
    expect(findSalesReportKind('3F')).toBe('redownload');
  });

  test('reads update ids as updates', () => {
    expect(findSalesReportKind('7')).toBe('update');
    expect(findSalesReportKind('F7')).toBe('update');
  });

  test('reads In-App Purchase ids as in-app purchases', () => {
    expect(findSalesReportKind('IA1')).toBe('in-app-purchase');
    expect(findSalesReportKind('IAY-M')).toBe('in-app-purchase');
  });

  test('ignores bundles and unknown ids', () => {
    expect(findSalesReportKind('1-B')).toBeNull();
    expect(findSalesReportKind('ZZ')).toBeNull();
    expect(findSalesReportKind('')).toBeNull();
  });
});
