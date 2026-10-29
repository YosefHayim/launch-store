export type PortfolioPlatform = 'ios' | 'android';
export type AppOwner = 'mine' | 'client';

export const APP_KEY_PATTERN = /^(ios|android)-[A-Za-z0-9._]+$/;

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
}

export interface DiscoveryWarning {
  readonly accountLabel: string;
  readonly message: string;
}

export interface DiscoveryReport {
  readonly apps: readonly DiscoveredApp[];
  readonly warnings: readonly DiscoveryWarning[];
  readonly attemptedSourceCount: number;
  readonly failedAccountLabels: readonly string[];
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
