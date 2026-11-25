import type {
  AppOwner,
  AppTag,
  AppTagChange,
  DiscoveredApp,
  PortfolioApp,
  PortfolioPlatform,
} from '../types/portfolio.js';

export const createIosAppKey = (ascAppId: string): string => `ios-${ascAppId}`;

export const createAndroidAppKey = (packageName: string): string => `android-${packageName}`;

export const mergeDiscoveredApps = (
  appLists: readonly (readonly DiscoveredApp[])[],
): DiscoveredApp[] => {
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
};

export const keepCachedAppsOfFailedAccounts = (
  discoveredApps: readonly DiscoveredApp[],
  cachedApps: readonly DiscoveredApp[],
  failedAccountLabels: readonly string[],
): DiscoveredApp[] => {
  const cachedAppsOfFailedAccounts = cachedApps.filter((cachedApp) =>
    failedAccountLabels.includes(cachedApp.accountLabel),
  );
  return mergeDiscoveredApps([discoveredApps, cachedAppsOfFailedAccounts]);
};

export const joinTags = (apps: readonly DiscoveredApp[], tags: readonly AppTag[]): PortfolioApp[] =>
  apps.map((app) => {
    const appTag = tags.find((tag) => tag.appKey === app.key);
    const isAppUntagged = appTag === undefined;
    if (isAppUntagged) return { ...app, owner: null, ga4PropertyId: null };
    return { ...app, owner: appTag.owner, ga4PropertyId: appTag.ga4PropertyId };
  });

export const findAppsByName = <FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  query: string,
): FoundApp[] => {
  const needle = query.trim().toLowerCase();
  const isNeedleEmpty = needle.length === 0;
  if (isNeedleEmpty) return [];
  return apps.filter((app) => {
    const searchableNames = [app.name, app.bundleId, app.packageName];
    return searchableNames.some((searchableName) => {
      const isNameMissing = searchableName === null;
      if (isNameMissing) return false;
      return searchableName.toLowerCase().includes(needle);
    });
  });
};

export const findAppsByAccount = <FoundApp extends DiscoveredApp>(
  apps: readonly FoundApp[],
  accountLabel: string,
): FoundApp[] => {
  const wantedLabel = accountLabel.trim().toLowerCase();
  return apps.filter((app) => app.accountLabel.toLowerCase() === wantedLabel);
};

export interface PortfolioFilter {
  readonly platform: PortfolioPlatform | null;
  readonly owner: AppOwner | null;
}

export const filterPortfolioApps = (
  apps: readonly PortfolioApp[],
  filter: PortfolioFilter,
): PortfolioApp[] =>
  apps.filter((app) => {
    const isPlatformWrong = filter.platform !== null && app.platform !== filter.platform;
    if (isPlatformWrong) return false;
    const isOwnerWrong = filter.owner !== null && app.owner !== filter.owner;
    if (isOwnerWrong) return false;
    return true;
  });

const keepWhenNull = <Field>(newField: Field | null, currentField: Field | null): Field | null => {
  const isNewFieldMissing = newField === null;
  if (isNewFieldMissing) return currentField;
  return newField;
};

export const applyTagChange = (
  tags: readonly AppTag[],
  appKeys: readonly string[],
  change: AppTagChange,
): AppTag[] => {
  const untouchedTags = tags.filter((tag) => !appKeys.includes(tag.appKey));
  const changedTags = appKeys.map((appKey): AppTag => {
    const currentTag = tags.find((tag) => tag.appKey === appKey);
    const isAppUntagged = currentTag === undefined;
    if (isAppUntagged) return { appKey, ...change };
    return {
      appKey,
      owner: keepWhenNull(change.owner, currentTag.owner),
      ga4PropertyId: keepWhenNull(change.ga4PropertyId, currentTag.ga4PropertyId),
    };
  });
  return [...untouchedTags, ...changedTags];
};

export const applyTagChangeToApp = (app: PortfolioApp, change: AppTagChange): PortfolioApp => ({
  ...app,
  owner: keepWhenNull(change.owner, app.owner),
  ga4PropertyId: keepWhenNull(change.ga4PropertyId, app.ga4PropertyId),
});
