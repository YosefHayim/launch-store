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

/** Merge per-source app lists into one list; the first source that sees an app key wins. */
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

/** Keep cached apps of sources that failed this time, so one revoked key does not empty its apps. */
export const keepCachedAppsOfFailedSources = (
  discoveredApps: readonly DiscoveredApp[],
  cachedApps: readonly DiscoveredApp[],
  failedAccountLabels: readonly string[],
): DiscoveredApp[] => {
  const cachedAppsOfFailedSources = cachedApps.filter((cachedApp) =>
    failedAccountLabels.includes(cachedApp.accountLabel),
  );
  return mergeDiscoveredApps([discoveredApps, cachedAppsOfFailedSources]);
};

/** Attach each app's owner and GA4 property from the tag list; untagged apps get nulls. */
export const joinTags = (apps: readonly DiscoveredApp[], tags: readonly AppTag[]): PortfolioApp[] =>
  apps.map((app) => {
    const appTag = tags.find((tag) => tag.appKey === app.key);
    if (appTag === undefined) return { ...app, owner: null, ga4PropertyId: null };
    return { ...app, owner: appTag.owner, ga4PropertyId: appTag.ga4PropertyId };
  });

/** Case-insensitive substring match over name, bundle id and package name. */
export const findAppsByName = <MatchedApp extends DiscoveredApp>(
  apps: readonly MatchedApp[],
  query: string,
): MatchedApp[] => {
  const needle = query.trim().toLowerCase();
  const isNeedleEmpty = needle.length === 0;
  if (isNeedleEmpty) return [];
  return apps.filter((app) => {
    const searchableTexts = [app.name, app.bundleId, app.packageName];
    return searchableTexts.some((searchableText) => {
      if (searchableText === null) return false;
      return searchableText.toLowerCase().includes(needle);
    });
  });
};

/** Every app that one account label sees (the label is `google-play` for Play apps). */
export const findAppsByAccount = <MatchedApp extends DiscoveredApp>(
  apps: readonly MatchedApp[],
  accountLabel: string,
): MatchedApp[] => {
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
    return !isOwnerWrong;
  });

/** Apply a tag change to the given apps. A null field in the change keeps the current value. */
export const applyTagChange = (
  tags: readonly AppTag[],
  appKeys: readonly string[],
  change: AppTagChange,
): AppTag[] => {
  const untouchedTags = tags.filter((tag) => !appKeys.includes(tag.appKey));
  const changedTags = appKeys.map((appKey): AppTag => {
    const currentTag = tags.find((tag) => tag.appKey === appKey);
    let owner = change.owner;
    let ga4PropertyId = change.ga4PropertyId;
    if (currentTag !== undefined && owner === null) owner = currentTag.owner;
    if (currentTag !== undefined && ga4PropertyId === null)
      ga4PropertyId = currentTag.ga4PropertyId;
    return { appKey, owner, ga4PropertyId };
  });
  return [...untouchedTags, ...changedTags];
};
