import { errorMessage } from '@/services/platform/error-message.js';
import type { PortfolioApp } from '@/types/portfolio.js';
import type { PlayVitalsMetric, VitalsTimeline } from '@/types/vitals.js';
import type {
  DailyStat,
  DateRange,
  FeedFetchReply,
  StatsFeedFailure,
  StatsMetric,
} from '@/types/stats.js';
import { pickEarlierDate } from '../date-range.ts';
import type { PlayVitalsReader, StatsCredentialsApi } from '../stats-credentials.ts';
import { readBucketReports } from './play-bucket-reports.ts';
import { STORAGE_READ_ONLY_SCOPE } from './play-reports-bucket-client.ts';

const dayMilliseconds = 24 * 60 * 60 * 1000;
const vitalsMetrics: Readonly<Record<PlayVitalsMetric, StatsMetric>> = {
  crash: 'crashRate',
  anr: 'anrRate',
};

interface VitalsReading {
  readonly stats: readonly DailyStat[];
  readonly publishedThrough: string;
}

interface PlayFetchRequest {
  readonly app: PortfolioApp;
  readonly range: DateRange;
  readonly credentials: StatsCredentialsApi;
}

function makeStatsFeedFailure(appKey: string, cause: unknown): StatsFeedFailure {
  return {
    _tag: 'StatsFeedFailure',
    feed: 'google-play',
    appKey,
    message: errorMessage(cause),
    cause,
  };
}

function countRangeDays(range: DateRange): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / dayMilliseconds) + 1;
}

function isPublishedDate(publishedDate: string | null): publishedDate is string {
  return publishedDate != null;
}

function pickCoveredThrough(publishedThroughDates: readonly (string | null)[]): string {
  return publishedThroughDates.filter(isPublishedDate).reduce(pickEarlierDate);
}

function readVitalsDay(range: DateRange, timeline: VitalsTimeline) {
  return function readDay(vitalsDay: VitalsTimeline['rows'][number]): DailyStat[] {
    const isBeforeRange = vitalsDay.date < range.from;
    const isAfterRange = vitalsDay.date > range.to;

    if (isBeforeRange) {
      return [];
    }

    if (isAfterRange) {
      return [];
    }

    if (vitalsDay.rate == null) {
      return [];
    }

    return [
      {
        date: vitalsDay.date,
        feed: 'google-play',
        metric: vitalsMetrics[timeline.metric],
        value: vitalsDay.rate,
        currency: null,
      },
    ];
  };
}

async function readTimeline(
  playClient: PlayVitalsReader,
  packageName: string,
  metric: PlayVitalsMetric,
  windowDays: number,
): Promise<VitalsTimeline> {
  return playClient.vitalsTimeline(packageName, metric, windowDays);
}

async function readVitals(
  playClient: PlayVitalsReader,
  packageName: string,
  range: DateRange,
): Promise<VitalsReading> {
  // Play publishes vitals a day or two behind, so the query window reaches back a little further than the range.
  const vitalsFreshnessBufferDays = 7;
  const windowDays = countRangeDays(range) + vitalsFreshnessBufferDays;
  const crashTimeline = await readTimeline(playClient, packageName, 'crash', windowDays);
  const anrTimeline = await readTimeline(playClient, packageName, 'anr', windowDays);
  const stats = [crashTimeline, anrTimeline].flatMap(function readTimelineStats(
    timeline: VitalsTimeline,
  ) {
    const vitalsDay = readVitalsDay(range, timeline);
    return timeline.rows.flatMap(vitalsDay);
  });

  return {
    stats,
    publishedThrough: pickEarlierDate(crashTimeline.window.endDate, anrTimeline.window.endDate),
  };
}

async function fetchPlayStats(
  app: PortfolioApp,
  packageName: string,
  range: DateRange,
  credentials: StatsCredentialsApi,
): Promise<FeedFetchReply> {
  const playClient = await credentials.playReportingClient(packageName);

  if (playClient == null) {
    return {
      status: 'skipped',
      reason: `No Play service account saved: run launch-store creds set-key --platform android --app ${app.name} <key.json>`,
    };
  }

  const vitals = await readVitals(playClient, packageName, range);
  const vitalsCoveredThrough = pickEarlierDate(vitals.publishedThrough, range.to);
  const reportsBucket = await credentials.playReportsBucket();

  if (reportsBucket == null) {
    return {
      status: 'fetched',
      stats: vitals.stats,
      coveredThrough: vitalsCoveredThrough,
      notes: [
        'Play reports bucket not set: copy the Cloud Storage URI from Play Console > Download reports, then run launch-store creds set-play-reports-bucket --play-reports-bucket <uri>',
      ],
    };
  }

  const accessToken = await credentials.googleAccessToken([STORAGE_READ_ONLY_SCOPE], packageName);

  if (accessToken == null) {
    throw new Error(`Could not get a Cloud Storage token for ${app.key}`);
  }

  const bucketReports = await readBucketReports({
    bucket: reportsBucket,
    accessToken,
    packageName,
    range,
  });

  if (bucketReports.status == 'forbidden') {
    return {
      status: 'fetched',
      stats: vitals.stats,
      coveredThrough: vitalsCoveredThrough,
      notes: [
        'The Play reports bucket refused the service account: in Play Console > Users and permissions, give it "View app information and download bulk reports" set to Global',
      ],
    };
  }

  // Earnings arrive a month at a time; a month still unpublished must stay uncovered so a later sync pulls it.
  const coveredThrough = pickCoveredThrough([
    vitalsCoveredThrough,
    bucketReports.csvPublishedThrough,
    bucketReports.earningsPublishedThrough,
  ]);

  return {
    status: 'fetched',
    stats: [...vitals.stats, ...bucketReports.stats],
    coveredThrough,
    notes: [],
  };
}

function isGooglePlayApplicable(app: PortfolioApp): boolean {
  return app.platform == 'android';
}

async function fetchGooglePlayDays(request: PlayFetchRequest): Promise<FeedFetchReply> {
  const packageName = request.app.packageName;

  if (packageName == null) {
    return { status: 'skipped', reason: `${request.app.name} has no package name` };
  }

  try {
    return await fetchPlayStats(request.app, packageName, request.range, request.credentials);
  } catch (cause) {
    throw makeStatsFeedFailure(request.app.key, cause);
  }
}

export const googlePlayFeed = {
  feed: 'google-play' as const,
  isApplicable: isGooglePlayApplicable,
  fetchDays: fetchGooglePlayDays,
};
