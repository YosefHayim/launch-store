import { describe, expect, test } from 'vitest';
import { findSalesReportKind } from './app-store-product-types.ts';

describe('findSalesReportKind', () => {
  test('reads first-time download ids as downloads', () => {
    const salesReportKind = findSalesReportKind('1');
    expect(salesReportKind).toBe('download');
    expect(findSalesReportKind('F1')).toBe('download');
  });

  test('reads re-download ids as redownloads', () => {
    const salesReportKind = findSalesReportKind('3');
    expect(salesReportKind).toBe('redownload');
    expect(findSalesReportKind('3F')).toBe('redownload');
  });

  test('reads update ids as updates', () => {
    const salesReportKind = findSalesReportKind('7');
    expect(salesReportKind).toBe('update');
    expect(findSalesReportKind('F7')).toBe('update');
  });

  test('reads In-App Purchase ids as in-app purchases', () => {
    const salesReportKind = findSalesReportKind('IA1');
    expect(salesReportKind).toBe('in-app-purchase');
    expect(findSalesReportKind('IAY-M')).toBe('in-app-purchase');
  });

  test('ignores bundles and unknown ids', () => {
    const salesReportKind = findSalesReportKind('1-B');
    expect(salesReportKind).toBeNull();
    expect(findSalesReportKind('ZZ')).toBeNull();
    expect(findSalesReportKind('')).toBeNull();
  });
});
