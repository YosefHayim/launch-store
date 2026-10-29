import type { SalesReportKind } from './appStoreFeedTypes.js';

// https://developer.apple.com/help/app-store-connect/reference/product-type-identifiers
const PRODUCT_TYPE_IDS_BY_KIND: Readonly<Record<SalesReportKind, readonly string[]>> = {
  download: ['1', '1E', '1EP', '1EU', '1F', '1T', 'F1'],
  redownload: ['3', '3F'],
  update: ['7', '7F', '7T', 'F7'],
  'in-app-purchase': ['FI1', 'IA1', 'IA1-M', 'IA3', 'IA9', 'IA9-M', 'IAY', 'IAY-M'],
};

const SALES_REPORT_KINDS: readonly SalesReportKind[] = [
  'download',
  'redownload',
  'update',
  'in-app-purchase',
];

/** What a Sales Report line counts as, or null for a product type the stats do not use (app bundles). */
export const findSalesReportKind = (productTypeId: string): SalesReportKind | null => {
  const matchingKind = SALES_REPORT_KINDS.find((kind) =>
    PRODUCT_TYPE_IDS_BY_KIND[kind].includes(productTypeId),
  );
  if (matchingKind === undefined) return null;
  return matchingKind;
};
