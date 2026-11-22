import { createLogger } from '../services/platform/logger.ts';
import { makeCommandExit } from '../terminal/command-exit.ts';
import { makeUsageFailure, type UsageFailure } from '../terminal/usage-failure.ts';
import type {
  AppOwner,
  AppTagChange,
  DiscoveryWarning,
  PortfolioApp,
  PortfolioPlatform,
} from '../types/portfolio.ts';
import { loadPortfolioApps } from './load-portfolio-apps.ts';
import {
  applyTagChangeToApp,
  filterPortfolioApps,
  findAppsByAccount,
  findAppsByName,
} from './portfolio-logic.ts';
import { saveAppTags } from './tag-apps.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

interface AppsListRequest {
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

function isUsageFailure(cause: unknown): cause is UsageFailure {
  return isFailureTag(cause, 'UsageFailure');
}

function finishUsageFailure(usageFailure: UsageFailure, isJson: boolean): never {
  const logger = createLogger(false);

  if (isJson) {
    logger.line(JSON.stringify({ ok: false, error: usageFailure.message }));
  }

  const isHumanOutput = isJson == false;

  if (isHumanOutput) {
    logger.error(usageFailure.message);
  }

  throw makeCommandExit({ exitCode: 2, message: usageFailure.message });
}

export async function parsePlatformFlag(
  platformFlag: string | undefined,
): Promise<PortfolioPlatform | null> {
  if (platformFlag == null) {
    return null;
  }

  if (platformFlag == 'ios') {
    return 'ios';
  }

  if (platformFlag == 'android') {
    return 'android';
  }

  throw makeUsageFailure({ message: '--platform must be ios or android.' });
}

export async function parseOwnerFlag(ownerFlag: string | undefined): Promise<AppOwner | null> {
  if (ownerFlag == null) {
    return null;
  }

  if (ownerFlag == 'mine') {
    return 'mine';
  }

  if (ownerFlag == 'client') {
    return 'client';
  }

  throw makeUsageFailure({ message: '--owner must be mine or client.' });
}

async function parseGa4PropertyFlag(ga4PropertyFlag: string | undefined): Promise<string | null> {
  if (ga4PropertyFlag == null) {
    return null;
  }

  // A GA4 property id is one or more digits and nothing else.
  const isPropertyValid = /^[0-9]+$/.test(ga4PropertyFlag);

  if (isPropertyValid) {
    return ga4PropertyFlag;
  }

  throw makeUsageFailure({
    message: '--ga4-property must be the numeric GA4 property id.',
  });
}

export async function parseTagRequest(request: AppsTagRequest): Promise<AppTagChange> {
  const hasApp = request.app != null;
  const hasAccount = request.account != null;
  const isSelectionAmbiguous = hasApp == hasAccount;

  if (isSelectionAmbiguous) {
    throw makeUsageFailure({
      message: 'Pass exactly one of --app <name> or --account <label>.',
    });
  }

  const owner = await parseOwnerFlag(request.owner);
  const ga4PropertyId = await parseGa4PropertyFlag(request.ga4Property);

  if (owner != null) {
    return { owner, ga4PropertyId };
  }

  if (ga4PropertyId != null) {
    return { owner, ga4PropertyId };
  }

  throw makeUsageFailure({
    message: 'Pass --owner mine|client and/or --ga4-property <id>.',
  });
}

function readStoreName(platform: PortfolioPlatform): string {
  switch (platform) {
    case 'ios':
      return 'App Store';
    case 'android':
      return 'Google Play';
  }
}

function readAppIdentifier(app: PortfolioApp): string {
  if (app.packageName != null) {
    return app.packageName;
  }

  if (app.bundleId != null) {
    return app.bundleId;
  }

  return app.storeId;
}

function readOwnerLabel(owner: AppOwner | null): string {
  if (owner == null) {
    return 'untagged';
  }

  return owner;
}

function describeApp(app: PortfolioApp): string {
  const identifier = readAppIdentifier(app);
  const storeName = readStoreName(app.platform);
  const ownerLabel = readOwnerLabel(app.owner);

  return `${app.name} (${identifier}) - ${storeName}, ${app.accountLabel}, ${ownerLabel}`;
}

function findAppsToTag(apps: readonly PortfolioApp[], request: AppsTagRequest): PortfolioApp[] {
  const appName = request.app;

  if (appName != null) {
    return findAppsByName(apps, appName);
  }

  const accountLabel = request.account;

  if (accountLabel != null) {
    return findAppsByAccount(apps, accountLabel);
  }

  return [];
}

function showWarnings(warnings: readonly DiscoveryWarning[]): void {
  const logger = createLogger(false);

  for (const warning of warnings) {
    logger.warn(`${warning.accountLabel}: ${warning.message}`);
  }
}

function readAppName(app: PortfolioApp): string {
  return app.name;
}

function readAppKey(app: PortfolioApp): string {
  return app.key;
}

type ApplyTag = (app: PortfolioApp) => PortfolioApp;

function tagApp(change: AppTagChange): ApplyTag {
  function applyChange(app: PortfolioApp): PortfolioApp {
    return applyTagChangeToApp(app, change);
  }

  return applyChange;
}

export async function appsListProgram(request: AppsListRequest): Promise<void> {
  const logger = createLogger(false);

  try {
    const platform = await parsePlatformFlag(request.platform);
    const owner = await parseOwnerFlag(request.owner);
    const portfolioLoad = await loadPortfolioApps('discover');
    const apps = filterPortfolioApps(portfolioLoad.apps, { platform, owner });

    if (request.isJson) {
      const listing = {
        ok: true,
        apps,
        warnings: portfolioLoad.warnings,
        isFromCache: portfolioLoad.isFromCache,
      };
      const listingLine = JSON.stringify(listing);
      logger.line(listingLine);
      return;
    }

    showWarnings(portfolioLoad.warnings);

    for (const app of apps) {
      const appLine = describeApp(app);
      logger.line(appLine);
    }

    const hasNoApps = apps.length == 0;

    if (hasNoApps) {
      logger.note('No apps found.');
    }
  } catch (cause) {
    if (isUsageFailure(cause)) {
      throw finishUsageFailure(cause, request.isJson);
    }

    throw cause;
  }
}

export async function appsTagProgram(request: AppsTagRequest): Promise<void> {
  const logger = createLogger(false);

  try {
    const change = await parseTagRequest(request);
    const portfolioLoad = await loadPortfolioApps('discover');
    const appsToTag = findAppsToTag(portfolioLoad.apps, request);
    const isNothingFound = appsToTag.length == 0;

    if (isNothingFound) {
      const knownNames = portfolioLoad.apps.map(readAppName).join(', ');
      const notFoundFailure = makeUsageFailure({
        message: `No app matched. Known apps: ${knownNames}.`,
      });

      throw notFoundFailure;
    }

    const appKeys = appsToTag.map(readAppKey);
    await saveAppTags(appKeys, change);
    const applyChange = tagApp(change);
    const taggedApps = appsToTag.map(applyChange);

    if (request.isJson) {
      const tagging = { ok: true, tagged: taggedApps, warnings: portfolioLoad.warnings };
      const taggingLine = JSON.stringify(tagging);
      logger.line(taggingLine);
      return;
    }

    showWarnings(portfolioLoad.warnings);

    for (const app of taggedApps) {
      const taggedLine = `Tagged ${describeApp(app)}`;
      logger.ok(taggedLine);
    }
  } catch (cause) {
    if (isUsageFailure(cause)) {
      throw finishUsageFailure(cause, request.isJson);
    }

    throw cause;
  }
}
