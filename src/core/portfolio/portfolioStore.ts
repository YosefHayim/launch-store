import type { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  readJsonFile,
  writeJsonFileAtomically,
  type JsonFileFailure,
} from '../services/atomicJsonFile.js';
import { locatePortfolioFilePath, type LaunchPathsService } from '../services/paths.js';
import type { PortfolioFile } from '../types/portfolio.js';

const OwnerSchema = Schema.Literal('mine', 'client');

const DiscoveredAppSchema = Schema.Struct({
  key: Schema.String,
  platform: Schema.Literal('ios', 'android'),
  storeId: Schema.String,
  name: Schema.String,
  bundleId: Schema.NullOr(Schema.String),
  packageName: Schema.NullOr(Schema.String),
  accountKeyId: Schema.NullOr(Schema.String),
  accountLabel: Schema.String,
});

const AppTagSchema = Schema.Struct({
  appKey: Schema.String,
  owner: Schema.NullOr(OwnerSchema),
  ga4PropertyId: Schema.NullOr(Schema.String),
});

const PortfolioFileSchema: Schema.Schema<PortfolioFile> = Schema.Struct({
  version: Schema.Literal(1),
  discoveredAt: Schema.NullOr(Schema.String),
  apps: Schema.Array(DiscoveredAppSchema),
  tags: Schema.Array(AppTagSchema),
});

type PortfolioStoreRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

export const createEmptyPortfolioFile = (): PortfolioFile => ({
  version: 1,
  discoveredAt: null,
  apps: [],
  tags: [],
});

/** The saved portfolio, or null when `portfolio.json` does not exist yet. */
export const loadPortfolioFile = (): Effect.Effect<
  PortfolioFile | null,
  JsonFileFailure,
  PortfolioStoreRequirements
> =>
  Effect.gen(function* () {
    const portfolioFilePath = yield* locatePortfolioFilePath();
    return yield* readJsonFile(portfolioFilePath, PortfolioFileSchema);
  });

export const savePortfolioFile = (
  portfolioFile: PortfolioFile,
): Effect.Effect<void, JsonFileFailure, PortfolioStoreRequirements> =>
  Effect.gen(function* () {
    const portfolioFilePath = yield* locatePortfolioFilePath();
    yield* writeJsonFileAtomically(portfolioFilePath, portfolioFile);
  });
