// Holds the apps Launch found on App Store Connect and Google Play, and who owns each.

export type PortfolioPlatform = 'ios' | 'android';

export type AppOwner = 'mine' | 'client';

export interface DiscoveredApp {
  readonly key: string;
  readonly platform: PortfolioPlatform;
  readonly storeId: string;
  readonly name: string;
  readonly bundleId: string | null;
  readonly packageName: string | null;
  readonly accountKeyId: string | null;
  readonly accountLabel: string;
}

export interface AppTag {
  readonly appKey: string;
  readonly owner: AppOwner | null;
  readonly ga4PropertyId: string | null;
}

export interface PortfolioApp extends DiscoveredApp {
  readonly owner: AppOwner | null;
  readonly ga4PropertyId: string | null;
}

export interface PortfolioFile {
  readonly version: 1;
  readonly discoveredAt: string | null;
  readonly apps: readonly DiscoveredApp[];
  readonly tags: readonly AppTag[];
  readonly playReportsBucket: string | null;
}

export interface DiscoveryWarning {
  readonly accountLabel: string;
  readonly message: string;
}

export interface PortfolioLoad {
  readonly apps: readonly PortfolioApp[];
  readonly warnings: readonly DiscoveryWarning[];
  readonly isFromCache: boolean;
}

export type PortfolioLoadMode = 'discover' | 'cache-first';

export interface AppTagChange {
  readonly owner: AppOwner | null;
  readonly ga4PropertyId: string | null;
}
