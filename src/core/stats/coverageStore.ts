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
import type { AppCoverage } from '../types/stats.js';

const COVERAGE_FILE_NAME = 'coverage.json';

const FeedCoverageSchema = Schema.Struct({
  lastSyncedAt: Schema.String,
  coveredFrom: Schema.NullOr(Schema.String),
  coveredThrough: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
});

const AppCoverageSchema: Schema.Schema<AppCoverage> = Schema.Struct({
  version: Schema.Literal(1),
  appKey: Schema.String,
  feeds: Schema.Struct({
    'app-store': Schema.optionalWith(FeedCoverageSchema, { exact: true }),
    'google-play': Schema.optionalWith(FeedCoverageSchema, { exact: true }),
    ga4: Schema.optionalWith(FeedCoverageSchema, { exact: true }),
  }),
});

type CoverageStoreFailure = InvalidAppKeyFailure | JsonFileFailure;
type CoverageStoreRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

export const createEmptyAppCoverage = (appKey: string): AppCoverage => ({
  version: 1,
  appKey,
  feeds: {},
});

const locateCoverageFile = (
  appKey: string,
): Effect.Effect<string, InvalidAppKeyFailure, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const appDirectory = yield* locateAppStatsDirectory(appKey);
    return pathService.join(appDirectory, COVERAGE_FILE_NAME);
  });

/** The saved coverage of one app, or an empty one when nothing was synced yet. */
export const loadAppCoverage = (
  appKey: string,
): Effect.Effect<AppCoverage, CoverageStoreFailure, CoverageStoreRequirements> =>
  Effect.gen(function* () {
    const coverageFilePath = yield* locateCoverageFile(appKey);
    const savedCoverage = yield* readJsonFile(coverageFilePath, AppCoverageSchema);
    if (savedCoverage === null) return createEmptyAppCoverage(appKey);
    return savedCoverage;
  });

export const saveAppCoverage = (
  appCoverage: AppCoverage,
): Effect.Effect<void, CoverageStoreFailure, CoverageStoreRequirements> =>
  Effect.gen(function* () {
    const coverageFilePath = yield* locateCoverageFile(appCoverage.appKey);
    yield* writeJsonFileAtomically(coverageFilePath, appCoverage);
  });
