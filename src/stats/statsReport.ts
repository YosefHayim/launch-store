import { filterPortfolioApps, findAppsByName } from '../portfolio/portfolioLogic.ts';
import type { PortfolioApp } from '../types/portfolio.ts';
import type { AppCoverage, DailyStat, DateRange, StatsFreshness } from '../types/stats.ts';
import type { AppStatsReport, StatsReport, StatsReportRequest } from '../types/statsReport.ts';
import { loadAppCoverage } from './coverageStore.ts';
import { createLastDaysRange, readYesterdayUtc } from './dateRange.ts';
import { ensureFreshStats } from './ensureFreshStats.ts';
import { loadMonthStats } from './statsStore.ts';
import {
  createMetricSeries,
  foldMetricTotals,
  isAppStale,
  keepStatsInRange,
  listAppMessages,
  listMonthsInRange,
} from './statsReportLogic.ts';
import { loadStatsPortfolio } from './syncStats.ts';

type StatsReportAppNotFoundFailure = Readonly<{
  readonly _tag: 'StatsReportAppNotFoundFailure';
  readonly message: string;
}>;

function makeStatsReportAppNotFoundFailure(message: string): StatsReportAppNotFoundFailure {
  return { _tag: 'StatsReportAppNotFoundFailure', message };
}

async function loadRangeStats(appKey: string, range: DateRange): Promise<DailyStat[]> {
  const months = listMonthsInRange(range);
  const monthsOfStats: DailyStat[][] = [];

  for (const month of months) {
    const monthStats = await loadMonthStats(appKey, month);
    monthsOfStats.push([...monthStats]);
  }

  return keepStatsInRange(monthsOfStats.flat(), range);
}

function createAppReport(
  app: PortfolioApp,
  stats: readonly DailyStat[],
  appCoverage: AppCoverage,
  freshness: StatsFreshness,
): AppStatsReport {
  return {
    key: app.key,
    name: app.name,
    platform: app.platform,
    owner: app.owner,
    accountLabel: app.accountLabel,
    totals: foldMetricTotals(stats),
    series: createMetricSeries(stats),
    isStale: isAppStale(freshness, app.key),
    messages: listAppMessages(appCoverage),
  };
}

function selectNamedApps(
  apps: readonly PortfolioApp[],
  appName: string | null,
): readonly PortfolioApp[] {
  if (appName == null) {
    return apps;
  }

  return findAppsByName(apps, appName);
}

function isRequestedNameMissing(
  appName: string | null,
  namedApps: readonly PortfolioApp[],
): boolean {
  if (appName == null) {
    return false;
  }

  return namedApps.length == 0;
}

/** Read the saved numbers of the selected apps for the last `days` days, marked with how fresh they are. */
async function readStatsReport(
  request: StatsReportRequest,
  freshness: StatsFreshness,
): Promise<StatsReport> {
  const portfolioLoad = await loadStatsPortfolio('cache-first');
  const namedApps = selectNamedApps(portfolioLoad.apps, request.appName);
  const isNamedAppMissing = isRequestedNameMissing(request.appName, namedApps);

  if (isNamedAppMissing) {
    const knownAppNames = portfolioLoad.apps
      .map(function readAppName(app: PortfolioApp): string {
        return app.name;
      })
      .join(', ');

    throw makeStatsReportAppNotFoundFailure(
      `No app matches "${request.appName}". Known apps: ${knownAppNames}.`,
    );
  }

  const selectedApps = filterPortfolioApps(namedApps, {
    platform: request.platform,
    owner: request.owner,
  });
  const lastDate = readYesterdayUtc();
  const range = createLastDaysRange(lastDate, request.days);
  const appReports: AppStatsReport[] = [];

  for (const app of selectedApps) {
    const stats = await loadRangeStats(app.key, range);
    const appCoverage = await loadAppCoverage(app.key);
    appReports.push(createAppReport(app, stats, appCoverage, freshness));
  }

  return { range, days: request.days, isStale: freshness.isStale, apps: appReports };
}

/**
 * Refresh old numbers once, then read them. A sync that failed does not fail the report: the old
 * numbers come back with `isStale: true`.
 */
export async function createStatsReport(request: StatsReportRequest): Promise<StatsReport> {
  const freshness = await ensureFreshStats(request.appName);

  return readStatsReport(request, freshness);
}
