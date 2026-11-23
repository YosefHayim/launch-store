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
  function filterCachedApp(cachedApp: DiscoveredApp) {
    return failedAccountLabels.includes(cachedApp.accountLabel);
  }

  const cachedAppsOfFailedAccounts = cachedApps.filter(filterCachedApp);

  return mergeDiscoveredApps([discoveredApps, cachedAppsOfFailedAccounts]);
}

export function joinTags(apps: readonly DiscoveredApp[], tags: readonly AppTag[]): PortfolioApp[] {
  function mapApp(app: DiscoveredApp) {
    function findTag(tag: AppTag) {
      return tag.appKey == app.key;
    }

    const appTag = tags.find(findTag);

    const isAppUntagged = appTag == null;

    if (isAppUntagged) return { ...app, owner: null, ga4PropertyId: null };

    return { ...app, owner: appTag.owner, ga4PropertyId: appTag.ga4PropertyId };
  }

  return apps.map(mapApp);
}

export function findAppsByName<FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  query: string,
): FoundApp[] {
  const needle = query.trim().toLowerCase();

  const isNeedleEmpty = needle.length == 0;

  if (isNeedleEmpty) return [];

  function filterApp2(app: FoundApp) {
    const searchableNames = [app.name, app.bundleId, app.packageName];

    function someSearchableName(searchableName: string | null) {
      const isNameMissing = searchableName == null;

      if (isNameMissing) return false;

      return searchableName.toLowerCase().includes(needle);
    }

    return searchableNames.some(someSearchableName);
  }

  return apps.filter(filterApp2);
}

export function findAppsByAccount<FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  accountLabel: string,
): FoundApp[] {
  const wantedLabel = accountLabel.trim().toLowerCase();

  function filterApp(app: FoundApp) {
    return app.accountLabel.toLowerCase() == wantedLabel;
  }

  return apps.filter(filterApp);
}

interface PortfolioFilter {
  readonly platform: PortfolioPlatform | null;
  readonly owner: AppOwner | null;
}

export function filterPortfolioApps(
  apps: readonly PortfolioApp[],
  filter: PortfolioFilter,
): PortfolioApp[] {
  function filterApp3(app: PortfolioApp) {
    const isPlatformWrong = filter.platform != null && app.platform != filter.platform;

    if (isPlatformWrong) return false;

    const isOwnerWrong = filter.owner != null && app.owner != filter.owner;

    if (isOwnerWrong) return false;

    return true;
  }

  return apps.filter(filterApp3);
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
  function filterTag(tag: AppTag) {
    return !appKeys.includes(tag.appKey);
  }

  const untouchedTags = tags.filter(filterTag);

  function mapAppKey(appKey: string): AppTag {
    function findTag2(tag: AppTag) {
      return tag.appKey == appKey;
    }

    const currentTag = tags.find(findTag2);

    const isAppUntagged = currentTag == null;

    if (isAppUntagged) return { appKey, ...change };

    return {
      appKey,
      owner: keepWhenNull(change.owner, currentTag.owner),
      ga4PropertyId: keepWhenNull(change.ga4PropertyId, currentTag.ga4PropertyId),
    };
  }

  const changedTags = appKeys.map(mapAppKey);

  return [...untouchedTags, ...changedTags];
}

export function applyTagChangeToApp(app: PortfolioApp, change: AppTagChange): PortfolioApp {
  return {
    ...app,
    owner: keepWhenNull(change.owner, app.owner),
    ga4PropertyId: keepWhenNull(change.ga4PropertyId, app.ga4PropertyId),
  };
}
