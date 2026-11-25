import type { DailyStat } from '../../types/stats.js';
import type { ReportLine, SalesReportKind } from './appStoreFeedTypes.js';
import { findSalesReportKind } from './appStoreProductTypes.js';
import { readCell, readNumberCell, readTotal, roundMoney } from './reportCells.js';

const APPLE_IDENTIFIER_COLUMN = 'Apple Identifier';
const PARENT_IDENTIFIER_COLUMN = 'Parent Identifier';
const SKU_COLUMN = 'SKU';
const PRODUCT_TYPE_COLUMN = 'Product Type Identifier';
const UNITS_COLUMN = 'Units';
const PROCEEDS_COLUMN = 'Developer Proceeds';
const PROCEEDS_CURRENCY_COLUMN = 'Currency of Proceeds';

interface SalesDay {
  readonly date: string;
  readonly storeId: string;
  readonly appSkus: ReadonlySet<string>;
}

interface SalesCountMetric {
  readonly kind: SalesReportKind;
  readonly metric: DailyStat['metric'];
}

const SALES_COUNT_METRICS: readonly SalesCountMetric[] = [
  { kind: 'download', metric: 'downloads' },
  { kind: 'redownload', metric: 'redownloads' },
  { kind: 'update', metric: 'updates' },
];

/** The SKUs of the app, read from its own lines; In-App Purchase lines name their app by SKU only. */
export const findAppSkus = (
  reportLines: readonly ReportLine[],
  storeId: string,
): ReadonlySet<string> => {
  const appLines = reportLines.filter(
    (line) => readCell(line, APPLE_IDENTIFIER_COLUMN) === storeId,
  );
  const skus = appLines.map((line) => readCell(line, SKU_COLUMN)).filter((sku) => sku !== '');
  return new Set(skus);
};

const isLineOfApp = (line: ReportLine, kind: SalesReportKind, day: SalesDay): boolean => {
  const isInAppPurchase = kind === 'in-app-purchase';
  if (isInAppPurchase) return day.appSkus.has(readCell(line, PARENT_IDENTIFIER_COLUMN));
  return readCell(line, APPLE_IDENTIFIER_COLUMN) === day.storeId;
};

/** Downloads, redownloads, updates and proceeds (per currency) of one app for one day of a Sales Report. */
export const summarizeSalesLines = (
  reportLines: readonly ReportLine[],
  day: SalesDay,
): readonly DailyStat[] => {
  const unitsByKind = new Map<SalesReportKind, number>();
  const proceedsByCurrency = new Map<string, number>();
  for (const line of reportLines) {
    const kind = findSalesReportKind(readCell(line, PRODUCT_TYPE_COLUMN));
    if (kind === null) continue;
    const isLineAboutApp = isLineOfApp(line, kind, day);
    if (!isLineAboutApp) continue;
    const units = readNumberCell(line, UNITS_COLUMN);
    unitsByKind.set(kind, readTotal(unitsByKind, kind) + units);
    const currency = readCell(line, PROCEEDS_CURRENCY_COLUMN);
    const lineProceeds = readNumberCell(line, PROCEEDS_COLUMN) * units;
    proceedsByCurrency.set(currency, readTotal(proceedsByCurrency, currency) + lineProceeds);
  }
  const countStats = SALES_COUNT_METRICS.flatMap(({ kind, metric }): DailyStat[] => {
    const units = unitsByKind.get(kind);
    if (units === undefined) return [];
    return [{ date: day.date, feed: 'app-store', metric, value: units, currency: null }];
  });
  const proceedsStats = [...proceedsByCurrency.entries()].flatMap(
    ([currency, proceeds]): DailyStat[] => {
      const roundedProceeds = roundMoney(proceeds);
      const isProceedsZero = roundedProceeds === 0;
      if (isProceedsZero) return [];
      const isCurrencyMissing = currency === '';
      if (isCurrencyMissing) return [];
      return [
        {
          date: day.date,
          feed: 'app-store',
          metric: 'proceeds',
          value: roundedProceeds,
          currency,
        },
      ];
    },
  );
  return [...countStats, ...proceedsStats];
};
