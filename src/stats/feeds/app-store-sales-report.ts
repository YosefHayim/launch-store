import type { DailyStat } from '../../types/stats.ts';
import type { ReportLine, SalesReportKind } from './app-store-feed-types.ts';
import { findSalesReportKind } from './app-store-product-types.ts';
import { readCell, readNumberCell, readTotal, roundMoney } from './report-cells.ts';

const APPLE_IDENTIFIER_COLUMN = 'Apple Identifier';

interface SalesDay {
  readonly date: string;
  readonly storeId: string;
  readonly appSkus: ReadonlySet<string>;
}

interface SalesCountMetric {
  readonly kind: SalesReportKind;
  readonly metric: DailyStat['metric'];
}

const salesCountMetrics: readonly SalesCountMetric[] = [
  { kind: 'download', metric: 'downloads' },
  { kind: 'redownload', metric: 'redownloads' },
  { kind: 'update', metric: 'updates' },
];

/** The SKUs of the app, read from its own lines; In-App Purchase lines name their app by SKU only. */
export function findAppSkus(
  reportLines: readonly ReportLine[],
  storeId: string,
): ReadonlySet<string> {
  function filterLine(line: { readonly [x: string]: string }) {
    return readCell(line, APPLE_IDENTIFIER_COLUMN) == storeId;
  }

  const appLines = reportLines.filter(filterLine);
  function mapLine(line: { readonly [x: string]: string }) {
    return readCell(line, 'SKU');
  }

  function filterSku(sku: string) {
    return sku != '';
  }

  const skus = appLines.map(mapLine).filter(filterSku);
  return new Set(skus);
}

function isLineOfApp(line: ReportLine, kind: SalesReportKind, day: SalesDay): boolean {
  const isInAppPurchase = kind == 'in-app-purchase';
  if (isInAppPurchase) {
    const cell = readCell(line, 'Parent Identifier');
    return day.appSkus.has(cell);
  }
  return readCell(line, APPLE_IDENTIFIER_COLUMN) == day.storeId;
}

/** Downloads, redownloads, updates and proceeds (per currency) of one app for one day of a Sales Report. */
export function summarizeSalesLines(
  reportLines: readonly ReportLine[],
  day: SalesDay,
): readonly DailyStat[] {
  const unitsByKind = new Map<SalesReportKind, number>();
  const proceedsByCurrency = new Map<string, number>();
  for (const line of reportLines) {
    const cell = readCell(line, 'Product Type Identifier');
    const kind = findSalesReportKind(cell);
    if (kind == null) continue;
    const isLineAboutApp = isLineOfApp(line, kind, day);
    if (!isLineAboutApp) continue;
    const units = readNumberCell(line, 'Units');
    const total = readTotal(unitsByKind, kind);
    unitsByKind.set(kind, total + units);
    const currency = readCell(line, 'Currency of Proceeds');
    const lineProceeds = readNumberCell(line, 'Developer Proceeds') * units;
    proceedsByCurrency.set(currency, readTotal(proceedsByCurrency, currency) + lineProceeds);
  }
  function flatMapPiece({ kind, metric }: SalesCountMetric): DailyStat[] {
    const units = unitsByKind.get(kind);
    if (units == null) return [];
    return [{ date: day.date, feed: 'app-store', metric, value: units, currency: null }];
  }

  const countStats = salesCountMetrics.flatMap(flatMapPiece);
  function flatMapPiece2([currency, proceeds]: [string, number]): DailyStat[] {
    const roundedProceeds = roundMoney(proceeds);
    const isProceedsZero = roundedProceeds == 0;
    if (isProceedsZero) return [];
    const isCurrencyMissing = currency == '';
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
  }

  const proceedsStats = [...proceedsByCurrency.entries()].flatMap(flatMapPiece2);
  return [...countStats, ...proceedsStats];
}
