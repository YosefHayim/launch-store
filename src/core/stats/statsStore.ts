import { Path, type FileSystem } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
  type DocumentFileFailure,
} from '../services/atomicDocumentFile.js';
import {
  locateAppStatsDirectory,
  type InvalidAppKeyFailure,
  type LaunchPathsService,
} from '../services/paths.js';
import type { DailyStat, StatsMonthFile } from '../types/stats.js';
import { groupStatsByMonth, mergeStats } from './statsLogic.js';

const DailyStatSchema = Schema.Struct({
  date: Schema.String,
  feed: Schema.Literal('app-store', 'google-play', 'ga4'),
  metric: Schema.Literal(
    'downloads',
    'redownloads',
    'updates',
    'proceeds',
    'impressions',
    'productPageViews',
    'sessions',
    'activeDevices',
    'crashes',
    'ratingAverage',
    'ratingCount',
    'installs',
    'uninstalls',
    'activeInstalls',
    'crashRate',
    'anrRate',
    'activeUsers',
    'newUsers',
  ),
  value: Schema.Number,
  currency: Schema.NullOr(Schema.String),
});

const StatsMonthFileSchema: Schema.Schema<StatsMonthFile> = Schema.Struct({
  version: Schema.Literal(1),
  appKey: Schema.String,
  month: Schema.String,
  stats: Schema.Array(DailyStatSchema),
});

type StatsStoreFailure = InvalidAppKeyFailure | DocumentFileFailure;
type StatsStoreRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

const listSavedStats = (savedFile: StatsMonthFile | null): readonly DailyStat[] => {
  const isFileMissing = savedFile === null;
  if (isFileMissing) return [];
  return savedFile.stats;
};

export const saveDailyStats = (
  appKey: string,
  stats: readonly DailyStat[],
): Effect.Effect<void, StatsStoreFailure, StatsStoreRequirements> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const appDirectory = yield* locateAppStatsDirectory(appKey);
    const statsByMonth = groupStatsByMonth(stats);
    for (const [month, monthStats] of statsByMonth) {
      const monthFilePath = pathService.join(appDirectory, `${month}.json`);
      const savedFile = yield* readDocumentFile(monthFilePath, StatsMonthFileSchema);
      const savedStats = listSavedStats(savedFile);
      const mergedStats = mergeStats(savedStats, monthStats);
      const monthFile: StatsMonthFile = { version: 1, appKey, month, stats: mergedStats };
      yield* writeDocumentFileAtomically(monthFilePath, monthFile);
    }
  });

/** Read the saved daily stats of one app and month; an empty list when nothing was saved yet. */
export const loadMonthStats = (
  appKey: string,
  month: string,
): Effect.Effect<readonly DailyStat[], StatsStoreFailure, StatsStoreRequirements> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const appDirectory = yield* locateAppStatsDirectory(appKey);
    const monthFile = yield* readDocumentFile(
      pathService.join(appDirectory, `${month}.json`),
      StatsMonthFileSchema,
    );
    if (monthFile === null) return [];
    return monthFile.stats;
  });
