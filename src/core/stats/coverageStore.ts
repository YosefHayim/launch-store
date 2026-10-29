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
import type { AppCoverage } from '../types/stats.js';

const COVERAGE_FILE_NAME = 'coverage.json';

const FeedCoverageSchema = Schema.Struct({
  lastSyncedAt: Schema.String,
  coveredFrom: Schema.NullOr(Schema.String),
  coveredThrough: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  // Files saved before lastNote existed have no such key.
  lastNote: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
});

const AppCoverageSchema = Schema.Struct({
  version: Schema.Literal(1),
  appKey: Schema.String,
  feeds: Schema.Struct({
    'app-store': Schema.optionalWith(FeedCoverageSchema, { exact: true }),
    'google-play': Schema.optionalWith(FeedCoverageSchema, { exact: true }),
    ga4: Schema.optionalWith(FeedCoverageSchema, { exact: true }),
  }),
});

type CoverageStoreFailure = InvalidAppKeyFailure | DocumentFileFailure;
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

export const loadAppCoverage = (
  appKey: string,
): Effect.Effect<AppCoverage, CoverageStoreFailure, CoverageStoreRequirements> =>
  Effect.gen(function* () {
    const coverageFilePath = yield* locateCoverageFile(appKey);
    const savedCoverage = yield* readDocumentFile(coverageFilePath, AppCoverageSchema);
    const isCoverageMissing = savedCoverage === null;
    if (isCoverageMissing) return createEmptyAppCoverage(appKey);
    return savedCoverage;
  });

export const saveAppCoverage = (
  appCoverage: AppCoverage,
): Effect.Effect<void, CoverageStoreFailure, CoverageStoreRequirements> =>
  Effect.gen(function* () {
    const coverageFilePath = yield* locateCoverageFile(appCoverage.appKey);
    yield* writeDocumentFileAtomically(coverageFilePath, appCoverage);
  });
