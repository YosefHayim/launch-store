import type { HttpClient } from '@effect/platform';
import type { Effect } from 'effect';
import type { PlayReportingClient } from '@google/playReporting.js';
import type { EffectAppStoreConnectClient } from '../services/appleStoreClient.js';
import type { PortfolioApp } from './portfolio.js';
import type { ServiceAccount } from './credentials.js';

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

export interface StatsMonthFile {
  readonly version: 1;
  readonly appKey: string;
  readonly month: string;
  readonly stats: readonly DailyStat[];
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

export interface StatsCredentialsShape {
  readonly ascClientForAccount: (
    accountKeyId: string,
  ) => Effect.Effect<EffectAppStoreConnectClient | null, StatsCredentialsFailure>;
  readonly vendorNumberForAccount: (
    accountKeyId: string,
  ) => Effect.Effect<string | null, StatsCredentialsFailure>;
  readonly playServiceAccount: () => Effect.Effect<ServiceAccount | null, StatsCredentialsFailure>;
  readonly playReportingClient: () => Effect.Effect<
    PlayReportingClient | null,
    StatsCredentialsFailure
  >;
  readonly playReportsBucket: () => Effect.Effect<string | null, StatsCredentialsFailure>;
  readonly googleAccessToken: (
    scopes: readonly string[],
  ) => Effect.Effect<string | null, StatsCredentialsFailure>;
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
  readonly fetchDays: (
    request: FeedFetchRequest,
  ) => Effect.Effect<FeedFetchReply, StatsFeedFailure, HttpClient.HttpClient>;
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
