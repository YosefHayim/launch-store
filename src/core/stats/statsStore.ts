import { Path, type FileSystem } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  readJsonFile,
  writeJsonFileAtomically,
  type JsonFileFailure,
} from '../services/atomicJsonFile.js';
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

type StatsStoreFailure = InvalidAppKeyFailure | JsonFileFailure;
type StatsStoreRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Save daily stats into the month files of one app; saved days that are not re-sent stay. */
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
      const savedFile = yield* readJsonFile(monthFilePath, StatsMonthFileSchema);
      let savedStats: readonly DailyStat[] = [];
      if (savedFile !== null) savedStats = savedFile.stats;
      const monthFile: StatsMonthFile = {
        version: 1,
        appKey,
        month,
        stats: mergeStats(savedStats, monthStats),
      };
      yield* writeJsonFileAtomically(monthFilePath, monthFile);
    }
  });
