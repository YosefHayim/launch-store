import { describe, expect, test } from 'vitest';
import { findSalesReportKind } from './product-type-identifiers.ts';

function describeFindSalesReportKind() {
  function readsFirstTimeDownloadIdsAsDownloads() {
    const salesReportKind = findSalesReportKind('1');
    expect(salesReportKind).toBe('download');
    expect(findSalesReportKind('F1')).toBe('download');
  }

  test('reads first-time download ids as downloads', readsFirstTimeDownloadIdsAsDownloads);

  function readsReDownloadIdsAsRedownloads() {
    const salesReportKind = findSalesReportKind('3');
    expect(salesReportKind).toBe('redownload');
    expect(findSalesReportKind('3F')).toBe('redownload');
  }

  test('reads re-download ids as redownloads', readsReDownloadIdsAsRedownloads);

  function readsUpdateIdsAsUpdates() {
    const salesReportKind = findSalesReportKind('7');
    expect(salesReportKind).toBe('update');
    expect(findSalesReportKind('F7')).toBe('update');
  }

  test('reads update ids as updates', readsUpdateIdsAsUpdates);

  function readsInAppPurchaseIdsAsInAppPurchases() {
    const salesReportKind = findSalesReportKind('IA1');
    expect(salesReportKind).toBe('in-app-purchase');
    expect(findSalesReportKind('IAY-M')).toBe('in-app-purchase');
  }

  test('reads In-App Purchase ids as in-app purchases', readsInAppPurchaseIdsAsInAppPurchases);

  function ignoresBundlesAndUnknownIds() {
    const salesReportKind = findSalesReportKind('1-B');
    expect(salesReportKind).toBeNull();
    expect(findSalesReportKind('ZZ')).toBeNull();
    expect(findSalesReportKind('')).toBeNull();
  }

  test('ignores bundles and unknown ids', ignoresBundlesAndUnknownIds);
}

describe('findSalesReportKind', describeFindSalesReportKind);
