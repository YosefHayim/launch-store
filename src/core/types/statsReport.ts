import type { AppOwner, PortfolioPlatform } from './portfolio.js';
import type { DateRange, MetricAggregation, StatsFeed, StatsMetric } from './stats.js';

export interface StatsReportRequest {
  readonly platform: PortfolioPlatform | null;
  readonly owner: AppOwner | null;
  readonly appName: string | null;
  readonly days: number;
}

export interface MetricTotal {
  readonly feed: StatsFeed;
  readonly metric: StatsMetric;
  readonly currency: string | null;
  readonly aggregation: MetricAggregation;
  readonly total: number;
  readonly dayCount: number;
}

export interface DailyPoint {
  readonly date: string;
  readonly amount: number;
}

export interface MetricSeries {
  readonly feed: StatsFeed;
  readonly metric: StatsMetric;
  readonly currency: string | null;
  readonly points: readonly DailyPoint[];
}

export interface AppStatsReport {
  readonly key: string;
  readonly name: string;
  readonly platform: PortfolioPlatform;
  readonly owner: AppOwner | null;
  readonly accountLabel: string;
  readonly totals: readonly MetricTotal[];
  readonly series: readonly MetricSeries[];
  readonly isStale: boolean;
  readonly messages: readonly string[];
}

export interface StatsReport {
  readonly range: DateRange;
  readonly days: number;
  readonly isStale: boolean;
  readonly apps: readonly AppStatsReport[];
}
