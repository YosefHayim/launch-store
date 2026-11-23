// Holds store and analytics feeds, their metrics, and the sync report Launch writes.

import type { AppStoreStatsClient, PlayVitalsReader } from '../stats/stats-credentials.ts';
import type { PortfolioApp } from './portfolio.ts';
import type { ServiceAccount } from './credentials.ts';

export type StatsFeed = 'app-store' | 'google-play' | 'ga4';
export const STATS_FEEDS: readonly StatsFeed[] = ['app-store', 'google-play', 'ga4'];

export type StatsMetric =
  | 'downloads'
  | 'redownloads'
  | 'updates'
  | 'proceeds'
  | 'impressions'
  | 'productPageViews'
  | 'sessions'
  | 'activeDevices'
  | 'crashes'
  | 'ratingAverage'
  | 'ratingCount'
  | 'installs'
  | 'uninstalls'
  | 'activeInstalls'
  | 'crashRate'
  | 'anrRate'
  | 'activeUsers'
  | 'newUsers';

export type MetricAggregation = 'sum' | 'latest' | 'average';
export const METRIC_AGGREGATION: Readonly<Record<StatsMetric, MetricAggregation>> = {
  downloads: 'sum',
  redownloads: 'sum',
  updates: 'sum',
  proceeds: 'sum',
  impressions: 'sum',
  productPageViews: 'sum',
  sessions: 'sum',
  crashes: 'sum',
  installs: 'sum',
  uninstalls: 'sum',
  newUsers: 'sum',
  activeUsers: 'sum',
  activeDevices: 'latest',
  activeInstalls: 'latest',
  ratingAverage: 'latest',
  ratingCount: 'latest',
  crashRate: 'average',
  anrRate: 'average',
};

export interface DailyStat {
  readonly date: string;
  readonly feed: StatsFeed;
  readonly metric: StatsMetric;
  readonly value: number;
  readonly currency: string | null;
}

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface FeedCoverage {
  readonly lastSyncedAt: string;
  readonly coveredFrom: string | null;
  readonly coveredThrough: string | null;
  readonly lastError: string | null;
  readonly lastNote: string | null;
}

export interface AppCoverage {
  readonly version: 1;
  readonly appKey: string;
  readonly feeds: Partial<Record<StatsFeed, FeedCoverage>>;
}

export type StatsCredentialsFailure = Readonly<{
  readonly _tag: 'StatsCredentialsFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

interface StatsCredentialsShape {
  readonly ascClientForAccount: (accountKeyId: string) => Promise<AppStoreStatsClient | null>;
  readonly vendorNumberForAccount: (accountKeyId: string) => Promise<string | null>;
  readonly googlePackageForApp: (app: PortfolioApp) => Promise<string | null>;
  readonly playServiceAccount: (packageName: string | null) => Promise<ServiceAccount | null>;
  readonly playReportingClient: (packageName: string | null) => Promise<PlayVitalsReader | null>;
  readonly playReportsBucket: () => Promise<string | null>;
  readonly googleAccessToken: (
    scopes: readonly string[],
    packageName: string | null,
  ) => Promise<string | null>;
}

interface FeedFetchRequest {
  readonly app: PortfolioApp;
  readonly range: DateRange;
  readonly credentials: StatsCredentialsShape;
}

export type FeedFetchReply =
  | { readonly status: 'skipped'; readonly reason: string }
  | {
      readonly status: 'fetched';
      readonly stats: readonly DailyStat[];
      readonly coveredThrough: string;
      readonly notes: readonly string[];
    };

export type StatsFeedFailure = Readonly<{
  readonly _tag: 'StatsFeedFailure';
  readonly feed: StatsFeed;
  readonly appKey: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export interface StatsFeedPlugin {
  readonly feed: StatsFeed;
  readonly isApplicable: (app: PortfolioApp) => boolean;
  readonly fetchDays: (request: FeedFetchRequest) => Promise<FeedFetchReply>;
}

export interface AppFeedSyncReport {
  readonly appKey: string;
  readonly feed: StatsFeed;
  readonly status: 'synced' | 'skipped' | 'failed' | 'up-to-date';
  readonly statsWritten: number;
  readonly message: string | null;
}

export interface StatsSyncReport {
  readonly syncedAt: string;
  readonly appFeeds: readonly AppFeedSyncReport[];
}

export interface StatsSyncRequest {
  readonly appName: string | null;
  readonly days: number;
}

export interface StatsFreshness {
  readonly isStale: boolean;
  readonly report: StatsSyncReport | null;
}
