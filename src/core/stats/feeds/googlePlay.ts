import type { HttpClient } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { PlayReportingClient } from '@google/playReporting.js';
import { errorMessage } from '../../services/errorMessage.js';
import type { PortfolioApp } from '../../types/portfolio.js';
import type { PlayVitalsMetric } from '../../types/vitals.js';
import type {
  DailyStat,
  DateRange,
  FeedFetchReply,
  StatsCredentialsShape,
  StatsFeedFailure,
  StatsFeedPlugin,
  StatsMetric,
} from '../../types/stats.js';
import { readBucketReports } from './playBucketReports.js';
import { STORAGE_READ_ONLY_SCOPE } from './playReportsBucketClient.js';

const makeStatsFeedFailure = Data.tagged<StatsFeedFailure>('StatsFeedFailure');

// Play publishes vitals a day or two behind, so the query window reaches back a little further than the range.
const VITALS_FRESHNESS_BUFFER_DAYS = 7;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const VITALS_METRICS: Readonly<Record<PlayVitalsMetric, StatsMetric>> = {
  crash: 'crashRate',
  anr: 'anrRate',
};

const BUCKET_NOT_SET_NOTE =
  'Play reports bucket not set: copy the Cloud Storage URI from Play Console > Download reports, then run launch creds set-play-reports-bucket --play-reports-bucket <uri>';
const BUCKET_FORBIDDEN_NOTE =
  'The Play reports bucket refused the service account: in Play Console > Users and permissions, give it "View app information and download bulk reports" set to Global';

interface VitalsReading {
  readonly stats: readonly DailyStat[];
  readonly publishedThrough: string;
}

const countRangeDays = (range: DateRange): number =>
  Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MILLISECONDS) + 1;

// ISO dates sort as text, so a plain string compare orders them.
const earlierDate = (first: string, second: string): string => {
  if (first < second) return first;
  return second;
};

const readVitals = (
  playClient: PlayReportingClient,
  packageName: string,
  range: DateRange,
): Effect.Effect<VitalsReading, unknown> =>
  Effect.gen(function* () {
    const windowDays = countRangeDays(range) + VITALS_FRESHNESS_BUFFER_DAYS;
    const [crashTimeline, anrTimeline] = yield* Effect.all([
      playClient.vitalsTimeline(packageName, 'crash', windowDays),
      playClient.vitalsTimeline(packageName, 'anr', windowDays),
    ]);
    const stats: DailyStat[] = [];
    for (const timeline of [crashTimeline, anrTimeline]) {
      for (const vitalsDay of timeline.rows) {
        const isOutsideRange = vitalsDay.date < range.from || vitalsDay.date > range.to;
        if (isOutsideRange) continue;
        if (vitalsDay.rate === undefined) continue;
        stats.push({
          date: vitalsDay.date,
          feed: 'google-play',
          metric: VITALS_METRICS[timeline.metric],
          value: vitalsDay.rate,
          currency: null,
        });
      }
    }
    return {
      stats,
      publishedThrough: earlierDate(crashTimeline.window.endDate, anrTimeline.window.endDate),
    };
  });

const fetchPlayStats = (
  app: PortfolioApp,
  packageName: string,
  range: DateRange,
  credentials: StatsCredentialsShape,
): Effect.Effect<FeedFetchReply, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const playClient = yield* credentials.playReportingClient();
    const isServiceAccountMissing = playClient === null;
    if (isServiceAccountMissing) {
      return {
        status: 'skipped',
        reason: 'No Play service account saved: run launch creds setup --platform android',
      } satisfies FeedFetchReply;
    }
    const vitals = yield* readVitals(playClient, packageName, range);
    const vitalsCoveredThrough = earlierDate(vitals.publishedThrough, range.to);
    const reportsBucket = yield* credentials.playReportsBucket();
    const isBucketNotSet = reportsBucket === null;
    if (isBucketNotSet) {
      return {
        status: 'fetched',
        stats: vitals.stats,
        coveredThrough: vitalsCoveredThrough,
        notes: [BUCKET_NOT_SET_NOTE],
      } satisfies FeedFetchReply;
    }
    const accessToken = yield* credentials.googleAccessToken([STORAGE_READ_ONLY_SCOPE]);
    const isAccessTokenMissing = accessToken === null;
    if (isAccessTokenMissing) {
      return yield* Effect.fail(`Could not get a Cloud Storage token for ${app.key}`);
    }
    const bucketReports = yield* readBucketReports({
      bucket: reportsBucket,
      accessToken,
      packageName,
      range,
    });
    if (bucketReports.status === 'forbidden') {
      return {
        status: 'fetched',
        stats: vitals.stats,
        coveredThrough: vitalsCoveredThrough,
        notes: [BUCKET_FORBIDDEN_NOTE],
      } satisfies FeedFetchReply;
    }
    // Earnings arrive a month at a time; a month still unpublished must stay uncovered so a later sync pulls it.
    let coveredThrough = earlierDate(vitalsCoveredThrough, bucketReports.csvPublishedThrough);
    if (bucketReports.earningsPublishedThrough !== null) {
      coveredThrough = earlierDate(coveredThrough, bucketReports.earningsPublishedThrough);
    }
    return {
      status: 'fetched',
      stats: [...vitals.stats, ...bucketReports.stats],
      coveredThrough,
      notes: [],
    } satisfies FeedFetchReply;
  });

export const googlePlayFeed: StatsFeedPlugin = {
  feed: 'google-play',
  isApplicable: (app) => app.platform === 'android',
  fetchDays: ({ app, range, credentials }) =>
    Effect.gen(function* () {
      const packageName = app.packageName;
      if (packageName === null) {
        return {
          status: 'skipped',
          reason: `${app.name} has no package name`,
        } satisfies FeedFetchReply;
      }
      return yield* fetchPlayStats(app, packageName, range, credentials);
    }).pipe(
      Effect.mapError((cause) =>
        makeStatsFeedFailure({
          feed: 'google-play',
          appKey: app.key,
          message: errorMessage(cause),
          cause,
        }),
      ),
    ),
};
