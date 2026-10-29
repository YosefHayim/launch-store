import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { JsonFileFailure } from '../services/atomicJsonFile.js';
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
import { filterPortfolioApps, findAppsByAccount, findAppsByName } from './portfolioLogic.js';
import { saveAppTags } from './tagApps.js';

export interface AppsListRequest {
  readonly platform: string | undefined;
  readonly owner: string | undefined;
  readonly json: boolean;
}

export interface AppsTagRequest {
  readonly app: string | undefined;
  readonly account: string | undefined;
  readonly owner: string | undefined;
  readonly ga4Property: string | undefined;
  readonly json: boolean;
}

type AppsCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Logger
  | Path.Path
  | StatsCredentialsShape;

const GA4_PROPERTY_PATTERN = /^[0-9]+$/;

export const parsePlatformFlag = (
  platformText: string | undefined,
): Effect.Effect<PortfolioPlatform | null, UsageFailure> => {
  if (platformText === undefined) return Effect.succeed(null);
  if (platformText === 'ios') return Effect.succeed('ios');
  if (platformText === 'android') return Effect.succeed('android');
  return Effect.fail(makeUsageFailure({ message: '--platform must be ios or android.' }));
};

export const parseOwnerFlag = (
  ownerText: string | undefined,
): Effect.Effect<AppOwner | null, UsageFailure> => {
  if (ownerText === undefined) return Effect.succeed(null);
  if (ownerText === 'mine') return Effect.succeed('mine');
  if (ownerText === 'client') return Effect.succeed('client');
  return Effect.fail(makeUsageFailure({ message: '--owner must be mine or client.' }));
};

/** Check the `apps tag` flags: one of --app or --account, and at least one change to make. */
export const parseTagRequest = (
  request: AppsTagRequest,
): Effect.Effect<AppTagChange, UsageFailure> =>
  Effect.gen(function* () {
    const hasApp = request.app !== undefined;
    const hasAccount = request.account !== undefined;
    if (hasApp === hasAccount) {
      return yield* Effect.fail(
        makeUsageFailure({ message: 'Pass exactly one of --app <name> or --account <label>.' }),
      );
    }
    const owner = yield* parseOwnerFlag(request.owner);
    let ga4PropertyId: string | null = null;
    if (request.ga4Property !== undefined) {
      const isGa4PropertyValid = GA4_PROPERTY_PATTERN.test(request.ga4Property);
      if (!isGa4PropertyValid) {
        return yield* Effect.fail(
          makeUsageFailure({ message: '--ga4-property must be the numeric GA4 property id.' }),
        );
      }
      ga4PropertyId = request.ga4Property;
    }
    const isNothingToChange = owner === null && ga4PropertyId === null;
    if (isNothingToChange) {
      return yield* Effect.fail(
        makeUsageFailure({ message: 'Pass --owner mine|client and/or --ga4-property <id>.' }),
      );
    }
    return { owner, ga4PropertyId };
  });

const describeApp = (app: PortfolioApp): string => {
  let owner = 'untagged';
  if (app.owner !== null) owner = app.owner;
  let storeName = 'App Store';
  if (app.platform === 'android') storeName = 'Google Play';
  let identifier = app.storeId;
  if (app.bundleId !== null) identifier = app.bundleId;
  if (app.packageName !== null) identifier = app.packageName;
  return `${app.name} (${identifier}) - ${storeName}, ${app.accountLabel}, ${owner}`;
};

const showWarnings = (warnings: readonly DiscoveryWarning[]): Effect.Effect<void, never, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    for (const warning of warnings) {
      yield* logger.warn(`${warning.accountLabel}: ${warning.message}`).pipe(Effect.orDie);
    }
  });

/** `launch apps list`: the apps of every saved store account, with their tags. */
export const appsListProgram = (
  request: AppsListRequest,
): Effect.Effect<void, CommandExit | JsonFileFailure, AppsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const platform = yield* parsePlatformFlag(request.platform);
    const owner = yield* parseOwnerFlag(request.owner);
    const portfolioLoad = yield* loadPortfolioApps('discover');
    const apps = filterPortfolioApps(portfolioLoad.apps, { platform, owner });
    if (request.json) {
      const listing = {
        ok: true,
        apps,
        warnings: portfolioLoad.warnings,
        isFromCache: portfolioLoad.isFromCache,
      };
      return yield* logger.line(JSON.stringify(listing)).pipe(Effect.orDie);
    }
    yield* showWarnings(portfolioLoad.warnings);
    for (const app of apps) yield* logger.line(describeApp(app)).pipe(Effect.orDie);
    const hasNoApps = apps.length === 0;
    if (hasNoApps) yield* logger.note('No apps found.').pipe(Effect.orDie);
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.json),
    ),
  );

/** `launch apps tag`: set the owner and/or GA4 property of the matching apps. */
export const appsTagProgram = (
  request: AppsTagRequest,
): Effect.Effect<void, CommandExit | JsonFileFailure, AppsCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    const change = yield* parseTagRequest(request);
    const portfolioLoad = yield* loadPortfolioApps('discover');
    let matchedApps: PortfolioApp[] = [];
    if (request.app !== undefined) matchedApps = findAppsByName(portfolioLoad.apps, request.app);
    if (request.account !== undefined) {
      matchedApps = findAppsByAccount(portfolioLoad.apps, request.account);
    }
    const isNothingMatched = matchedApps.length === 0;
    if (isNothingMatched) {
      const knownNames = portfolioLoad.apps.map((app) => app.name).join(', ');
      return yield* Effect.fail(
        makeUsageFailure({ message: `No app matched. Known apps: ${knownNames}.` }),
      );
    }
    yield* saveAppTags(
      matchedApps.map((app) => app.key),
      change,
    );
    const taggedApps = matchedApps.map(
      (app): PortfolioApp => ({
        ...app,
        owner: change.owner === null ? app.owner : change.owner,
        ga4PropertyId: change.ga4PropertyId === null ? app.ga4PropertyId : change.ga4PropertyId,
      }),
    );
    if (request.json) {
      const tagging = { ok: true, tagged: taggedApps, warnings: portfolioLoad.warnings };
      return yield* logger.line(JSON.stringify(tagging)).pipe(Effect.orDie);
    }
    yield* showWarnings(portfolioLoad.warnings);
    for (const app of taggedApps) yield* logger.ok(`Tagged ${describeApp(app)}`).pipe(Effect.orDie);
  }).pipe(
    Effect.catchTag('UsageFailure', (usageFailure) =>
      endWithUsageFailure(usageFailure, request.json),
    ),
  );
