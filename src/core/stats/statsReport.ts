import { Data, Effect } from 'effect';
import { loadPortfolioApps } from '../portfolio/loadPortfolioApps.js';
import { filterPortfolioApps, findAppsByName } from '../portfolio/portfolioLogic.js';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import type { InvalidAppKeyFailure } from '../services/paths.js';
import type { PortfolioApp } from '../types/portfolio.js';
import type { DailyStat, DateRange, StatsFreshness } from '../types/stats.js';
import type { AppStatsReport, StatsReport, StatsReportRequest } from '../types/statsReport.js';
import { createLastDaysRange, readYesterdayUtc } from './dateRange.js';
import { ensureFreshStats } from './ensureFreshStats.js';
import { loadMonthStats } from './statsStore.js';
import {
  createMetricSeries,
  foldMetricTotals,
  isAppStale,
  keepStatsInRange,
  listAppMessages,
  listMonthsInRange,
} from './statsReportLogic.js';
import type { StatsSyncRequirements } from './syncStats.js';

type StatsReportAppNotFoundFailure = Readonly<{
  readonly _tag: 'StatsReportAppNotFoundFailure';
  readonly message: string;
}>;

const makeStatsReportAppNotFoundFailure = Data.tagged<StatsReportAppNotFoundFailure>(
  'StatsReportAppNotFoundFailure',
);

export type StatsReportFailure =
  | InvalidAppKeyFailure
  | DocumentFileFailure
  | StatsReportAppNotFoundFailure;

const loadRangeStats = (
  appKey: string,
  range: DateRange,
): Effect.Effect<DailyStat[], InvalidAppKeyFailure | DocumentFileFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const allStats: DailyStat[] = [];
    for (const month of listMonthsInRange(range)) {
      const monthStats = yield* loadMonthStats(appKey, month);
      allStats.push(...monthStats);
    }
    return keepStatsInRange(allStats, range);
  });

const createAppReport = (
  app: PortfolioApp,
  stats: readonly DailyStat[],
  freshness: StatsFreshness,
): AppStatsReport => ({
  key: app.key,
  name: app.name,
  platform: app.platform,
  owner: app.owner,
  accountLabel: app.accountLabel,
  totals: foldMetricTotals(stats),
  series: createMetricSeries(stats),
  isStale: isAppStale(freshness, app.key),
  messages: listAppMessages(freshness, app.key),
});

const selectNamedApps = (
  apps: readonly PortfolioApp[],
  appName: string | null,
): readonly PortfolioApp[] => {
  if (appName === null) return apps;
  return findAppsByName(apps, appName);
};

/** Read the saved numbers of the selected apps for the last `days` days, marked with how fresh they are. */
export const readStatsReport = (
  request: StatsReportRequest,
  freshness: StatsFreshness,
): Effect.Effect<StatsReport, StatsReportFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const portfolioLoad = yield* loadPortfolioApps('cache-first');
    const namedApps = selectNamedApps(portfolioLoad.apps, request.appName);
    const isNamedAppMissing = request.appName !== null && namedApps.length === 0;
    if (isNamedAppMissing) {
      const knownAppNames = portfolioLoad.apps.map((app) => app.name).join(', ');
      return yield* Effect.fail(
        makeStatsReportAppNotFoundFailure({
          message: `No app matches "${request.appName}". Known apps: ${knownAppNames}.`,
        }),
      );
    }
    const selectedApps = filterPortfolioApps(namedApps, {
      platform: request.platform,
      owner: request.owner,
    });
    const lastDate = yield* readYesterdayUtc();
    const range = createLastDaysRange(lastDate, request.days);
    const appReports = yield* Effect.forEach(selectedApps, (app) =>
      loadRangeStats(app.key, range).pipe(
        Effect.map((stats) => createAppReport(app, stats, freshness)),
      ),
    );
    return { range, days: request.days, isStale: freshness.isStale, apps: appReports };
  });

/**
 * Refresh old numbers once, then read them. A sync that failed does not fail the report: the old
 * numbers come back with `isStale: true`.
 */
export const createStatsReport = (
  request: StatsReportRequest,
): Effect.Effect<StatsReport, StatsReportFailure, StatsSyncRequirements> =>
  Effect.gen(function* () {
    const freshness = yield* ensureFreshStats(request.appName);
    return yield* readStatsReport(request, freshness);
  });
