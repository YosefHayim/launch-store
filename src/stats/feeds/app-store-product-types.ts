// Maps an App Store Connect product type identifier to a sales report kind.

import type { SalesReportKind } from './app-store-feed-types.ts';

// https://developer.apple.com/help/app-store-connect/reference/product-type-identifiers
const productTypeIdsByKind: Readonly<Record<SalesReportKind, readonly string[]>> = {
  download: ['1', '1E', '1EP', '1EU', '1F', '1T', 'F1'],
  redownload: ['3', '3F'],
  update: ['7', '7F', '7T', 'F7'],
  'in-app-purchase': ['FI1', 'IA1', 'IA1-M', 'IA3', 'IA9', 'IA9-M', 'IAY', 'IAY-M'],
};

const salesReportKinds: readonly SalesReportKind[] = [
  'download',
  'redownload',
  'update',
  'in-app-purchase',
];

/** What a Sales Report line counts as, or null for a product type the stats do not use (app bundles). */
export function findSalesReportKind(productTypeId: string): SalesReportKind | null {
  function hasProductType(kind: 'download' | 'redownload' | 'update' | 'in-app-purchase') {
    return productTypeIdsByKind[kind].includes(productTypeId);
  }

  const reportKind = salesReportKinds.find(hasProductType);

  if (reportKind == null) {
    return null;
  }

  return reportKind;
}
