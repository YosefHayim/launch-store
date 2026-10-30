import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { DocumentFileFailure } from '../services/atomicDocumentFile.js';
import { LaunchLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { CommandExit } from '../terminal/commandExit.js';
import {
  endWithUsageFailure,
  makeUsageFailure,
  type UsageFailure,
} from '../terminal/usageFailure.js';
import type {
  AppOwner,
  AppTagChange,
  DiscoveryWarning,
  PortfolioApp,
  PortfolioPlatform,
} from '../types/portfolio.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import { loadPortfolioApps } from './loadPortfolioApps.js';
import {
  applyTagChangeToApp,
  filterPortfolioApps,
  findAppsByAccount,
  findAppsByName,
} from './portfolioLogic.js';
import { saveAppTags } from './tagApps.js';

export interface AppsListRequest {
  readonly platform: string | undefined;
  readonly owner: string | undefined;
  readonly isJson: boolean;
}

export interface AppsTagRequest {
  readonly app: string | undefined;
  readonly account: string | undefined;
  readonly owner: string | undefined;
  readonly ga4Property: string | undefined;
  readonly isJson: boolean;
}

type AppsCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Logger
  | Path.Path
  | StatsCredentialsShape;

const GA4_PROPERTY_PATTERN = /^[0-9]+$/;

export const parsePlatformFlag = (
  platformFlag: string | undefined,
): Effect.Effect<PortfolioPlatform | null, UsageFailure> => {
  const isPlatformFlagMissing = platformFlag === undefined;
  if (isPlatformFlagMissing) return Effect.succeed(null);
  const isIos = platformFlag === 'ios';
  if (isIos) return Effect.succeed('ios');
  const isAndroid = platformFlag === 'android';
  if (isAndroid) return Effect.succeed('android');
  const platformFailure = makeUsageFailure({ message: '--platform must be ios or android.' });
  return Effect.fail(platformFailure);
};

export const parseOwnerFlag = (
  ownerFlag: string | undefined,
): Effect.Effect<AppOwner | null, UsageFailure> => {
  const isOwnerFlagMissing = ownerFlag === undefined;
  if (isOwnerFlagMissing) return Effect.succeed(null);
  const isMine = ownerFlag === 'mine';
  if (isMine) return Effect.succeed('mine');
  const isClient = ownerFlag === 'client';
  if (isClient) return Effect.succeed('client');
  const ownerFailure = makeUsageFailure({ message: '--owner must be mine or client.' });
  return Effect.fail(ownerFailure);
};

const parseGa4PropertyFlag = (
  ga4PropertyFlag: string | undefined,
): Effect.Effect<string | null, UsageFailure> => {
  const isFlagMissing = ga4PropertyFlag === undefined;
  if (isFlagMissing) return Effect.succeed(null);
  const isPropertyValid = GA4_PROPERTY_PATTERN.test(ga4PropertyFlag);
  if (isPropertyValid) return Effect.succeed(ga4PropertyFlag);
  const propertyFailure = makeUsageFailure({
    message: '--ga4-property must be the numeric GA4 property id.',
  });
  return Effect.fail(propertyFailure);
};

export const parseTagRequest = (
  request: AppsTagRequest,
): Effect.Effect<AppTagChange, UsageFailure> =>
  Effect.gen(function* () {
    const hasApp = request.app !== undefined;
    const hasAccount = request.account !== undefined;
    const isSelectionAmbiguous = hasApp === hasAccount;
    if (isSelectionAmbiguous) {
      const selectionFailure = makeUsageFailure({
        message: 'Pass exactly one of --app <name> or --account <label>.',
      });
      return yield* Effect.fail(selectionFailure);
    }
    const owner = yield* parseOwnerFlag(request.owner);
    const ga4PropertyId = yield* parseGa4PropertyFlag(request.ga4Property);
    const isNothingToChange = owner === null && ga4PropertyId === null;
    if (isNothingToChange) {
      const changeFailure = makeUsageFailure({
        message: 'Pass --owner mine|client and/or --ga4-property <id>.',
      });
      return yield* Effect.fail(changeFailure);
    }
    return { owner, ga4PropertyId };
  });

const readStoreName = (platform: PortfolioPlatform): string => {
  switch (platform) {
    case 'ios':
      return 'App Store';
    case 'android':
      return 'Google Play';
  }
};

const readAppIdentifier = (app: PortfolioApp): string => {
  const hasPackageName = app.packageName !== null;
  if (hasPackageName) return app.packageName;
  const hasBundleId = app.bundleId !== null;
  if (hasBundleId) return app.bundleId;
  return app.storeId;
};

const readOwnerLabel = (owner: AppOwner | null): string => {
  const isUntagged = owner === null;
  if (isUntagged) return 'untagged';
  return owner;
};

const describeApp = (app: PortfolioApp): string => {
  const identifier = readAppIdentifier(app);
  const storeName = readStoreName(app.platform);
  const ownerLabel = readOwnerLabel(app.owner);
  return `${app.name} (${identifier}) - ${storeName}, ${app.accountLabel}, ${ownerLabel}`;
};

const findAppsToTag = (apps: readonly PortfolioApp[], request: AppsTagRequest): PortfolioApp[] => {
  const { app: appName, account: accountLabel } = request;
  const hasAppName = appName !== undefined;
  if (hasAppName) return findAppsByName(apps, appName);
  const hasAccountLabel = accountLabel !== undefined;
  if (hasAccountLabel) return findAppsByAccount(apps, accountLabel);
  return [];
};

const showWarnings = (warnings: readonly DiscoveryWarning[]): Effect.Effect<void, never, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    for (const warning of warnings) {
      yield* logger.warn(`${warning.accountLabel}: ${warning.message}`).pipe(Effect.orDie);
    }
  });

export const appsListProgram = (
  request: AppsListRequest,
): Effect.Effect<void, CommandExit | DocumentFileFailure, AppsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const platform = yield* parsePlatformFlag(request.platform);
    const owner = yield* parseOwnerFlag(request.owner);
    const portfolioLoad = yield* loadPortfolioApps('discover');
    const apps = filterPortfolioApps(portfolioLoad.apps, { platform, owner });
    if (request.isJson) {
      const listing = {
        ok: true,
        apps,
        warnings: portfolioLoad.warnings,
        isFromCache: portfolioLoad.isFromCache,
      };
      const listingLine = JSON.stringify(listing);
      return yield* logger.line(listingLine).pipe(Effect.orDie);
    }
    yield* showWarnings(portfolioLoad.warnings);
    for (const app of apps) {
      const appLine = describeApp(app);
      yield* logger.line(appLine).pipe(Effect.orDie);
    }
    const hasNoApps = apps.length === 0;
    if (hasNoApps) yield* logger.note('No apps found.').pipe(Effect.orDie);
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.isJson),
    ),
  );

export const appsTagProgram = (
  request: AppsTagRequest,
): Effect.Effect<void, CommandExit | DocumentFileFailure, AppsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const change = yield* parseTagRequest(request);
    const portfolioLoad = yield* loadPortfolioApps('discover');
    const appsToTag = findAppsToTag(portfolioLoad.apps, request);
    const isNothingFound = appsToTag.length === 0;
    if (isNothingFound) {
      const knownNames = portfolioLoad.apps.map((app) => app.name).join(', ');
      const notFoundFailure = makeUsageFailure({
        message: `No app matched. Known apps: ${knownNames}.`,
      });
      return yield* Effect.fail(notFoundFailure);
    }
    const appKeys = appsToTag.map((app) => app.key);
    yield* saveAppTags(appKeys, change);
    const taggedApps = appsToTag.map((app) => applyTagChangeToApp(app, change));
    if (request.isJson) {
      const tagging = { ok: true, tagged: taggedApps, warnings: portfolioLoad.warnings };
      const taggingLine = JSON.stringify(tagging);
      return yield* logger.line(taggingLine).pipe(Effect.orDie);
    }
    yield* showWarnings(portfolioLoad.warnings);
    for (const app of taggedApps) {
      const taggedLine = `Tagged ${describeApp(app)}`;
      yield* logger.ok(taggedLine).pipe(Effect.orDie);
    }
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.isJson),
    ),
  );
