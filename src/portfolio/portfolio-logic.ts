import type {
  AppOwner,
  AppTag,
  AppTagChange,
  DiscoveredApp,
  PortfolioApp,
  PortfolioPlatform,
} from '../types/portfolio.ts';

export function createIosAppKey(ascAppId: string): string {
  return `ios-${ascAppId}`;
}

export function createAndroidAppKey(packageName: string): string {
  return `android-${packageName}`;
}

export function mergeDiscoveredApps(
  appLists: readonly (readonly DiscoveredApp[])[],
): DiscoveredApp[] {
  const seenKeys = new Set<string>();
  const mergedApps: DiscoveredApp[] = [];

  for (const appList of appLists) {
    for (const app of appList) {
      const isAppAlreadySeen = seenKeys.has(app.key);

      if (isAppAlreadySeen) continue;

      seenKeys.add(app.key);
      mergedApps.push(app);
    }
  }

  return mergedApps;
}

export function keepCachedAppsOfFailedAccounts(
  discoveredApps: readonly DiscoveredApp[],
  cachedApps: readonly DiscoveredApp[],
  failedAccountLabels: readonly string[],
): DiscoveredApp[] {
  function belongsToFailedAccount(cachedApp: DiscoveredApp) {
    return failedAccountLabels.includes(cachedApp.accountLabel);
  }

  const cachedAppsOfFailedAccounts = cachedApps.filter(belongsToFailedAccount);

  return mergeDiscoveredApps([discoveredApps, cachedAppsOfFailedAccounts]);
}

export function joinTags(apps: readonly DiscoveredApp[], tags: readonly AppTag[]): PortfolioApp[] {
  function attachTagToApp(app: DiscoveredApp) {
    function isTagOfApp(tag: AppTag) {
      return tag.appKey == app.key;
    }

    const appTag = tags.find(isTagOfApp);

    const isAppUntagged = appTag == null;

    if (isAppUntagged) return { ...app, owner: null, ga4PropertyId: null };

    return { ...app, owner: appTag.owner, ga4PropertyId: appTag.ga4PropertyId };
  }

  return apps.map(attachTagToApp);
}

export function findAppsByName<FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  query: string,
): FoundApp[] {
  const needle = query.trim().toLowerCase();

  const isNeedleEmpty = needle.length == 0;

  if (isNeedleEmpty) return [];

  function includesQuery(app: FoundApp) {
    const searchableNames = [app.name, app.bundleId, app.packageName];

    function fieldIncludesNeedle(searchableName: string | null) {
      const isNameMissing = searchableName == null;

      if (isNameMissing) return false;

      return searchableName.toLowerCase().includes(needle);
    }

    return searchableNames.some(fieldIncludesNeedle);
  }

  return apps.filter(includesQuery);
}

export function findAppsByAccount<FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  accountLabel: string,
): FoundApp[] {
  const wantedLabel = accountLabel.trim().toLowerCase();

  function hasWantedAccount(app: FoundApp) {
    return app.accountLabel.toLowerCase() == wantedLabel;
  }

  return apps.filter(hasWantedAccount);
}

interface PortfolioFilter {
  readonly platform: PortfolioPlatform | null;
  readonly owner: AppOwner | null;
}

export function filterPortfolioApps(
  apps: readonly PortfolioApp[],
  filter: PortfolioFilter,
): PortfolioApp[] {
  function passesOwnerAndPlatform(app: PortfolioApp) {
    const isPlatformWrong = filter.platform != null && app.platform != filter.platform;

    if (isPlatformWrong) return false;

    const isOwnerWrong = filter.owner != null && app.owner != filter.owner;

    if (isOwnerWrong) return false;

    return true;
  }

  return apps.filter(passesOwnerAndPlatform);
}

function keepWhenNull<Field>(newField: Field | null, currentField: Field | null): Field | null {
  const isNewFieldMissing = newField == null;

  if (isNewFieldMissing) return currentField;

  return newField;
}

export function applyTagChange(
  tags: readonly AppTag[],
  appKeys: readonly string[],
  change: AppTagChange,
): AppTag[] {
  function keepsUntouchedTag(tag: AppTag) {
    return !appKeys.includes(tag.appKey);
  }

  const untouchedTags = tags.filter(keepsUntouchedTag);

  function writeChangedTag(appKey: string): AppTag {
    function isTagOfKey(tag: AppTag) {
      return tag.appKey == appKey;
    }

    const currentTag = tags.find(isTagOfKey);

    const isAppUntagged = currentTag == null;

    if (isAppUntagged) return { appKey, ...change };

    return {
      appKey,
      owner: keepWhenNull(change.owner, currentTag.owner),
      ga4PropertyId: keepWhenNull(change.ga4PropertyId, currentTag.ga4PropertyId),
    };
  }

  const changedTags = appKeys.map(writeChangedTag);

  return [...untouchedTags, ...changedTags];
}

export function applyTagChangeToApp(app: PortfolioApp, change: AppTagChange): PortfolioApp {
  return {
    ...app,
    owner: keepWhenNull(change.owner, app.owner),
    ga4PropertyId: keepWhenNull(change.ga4PropertyId, app.ga4PropertyId),
  };
}
