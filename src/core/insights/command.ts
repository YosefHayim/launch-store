import { Data, Effect } from 'effect';
import { loadConfig } from '../config/config.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths } from '../services/paths.js';
import type { EffectAppStoreConnectClient } from '../services/appleStoreClient.js';
import type { EffectGooglePlayClient } from '../services/googleStoreClient.js';
import { listReviews } from '../store/reviews.js';
import { createAscClientResolver, createPlayClientResolver } from '../store/storeClients.js';
import { selectApps } from '../store/syncJobs.js';
import type { AppDescriptor } from '../types/app.js';
import type { CustomerReviewResource } from '../types/appleCatalog.js';
import type { PlayReview } from '../types/googlePlay.js';
import type {
  InsightsReport,
  InsightsStore,
  RatingSummary,
  ReviewDatum,
  StarRating,
} from '../types/insights.js';
import { buildInsightsReport, STARS } from './aggregate.js';

/** Options accepted by the cross-store insights command. */
export type InsightsCommandOptions = Readonly<{
  app?: string | undefined;
  json: boolean;
}>;

/** Loading or rendering cross-store review insights failed. */
export type InsightsCommandFailure = Readonly<{
  readonly _tag: 'InsightsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeInsightsCommandFailure =
  Data.tagged<InsightsCommandFailure>('InsightsCommandFailure');

/** Convert any dependency failure into the insights command channel. */
const insightsFailure = (operation: string, cause: unknown): InsightsCommandFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeInsightsCommandFailure({ operation, message, cause });
};

/** Narrow an external rating to Launch's one-to-five-star domain. */
const toStarRating = (rating: number): StarRating | null => {
  switch (rating) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return rating;
    default:
      return null;
  }
};

/** Normalize App Store reviews to the aggregate's store-neutral fields. */
const normalizeAscReviews = (customerReviews: readonly CustomerReviewResource[]): ReviewDatum[] => {
  const normalizedReviews: ReviewDatum[] = [];
  for (const customerReview of customerReviews) {
    const starRating = toStarRating(customerReview.rating);
    if (starRating === null) continue;
    const normalizedReview: ReviewDatum = {
      store: 'appstore',
      rating: starRating,
      answered: customerReview.answered,
    };
    if (customerReview.createdDate !== undefined) {
      normalizedReview.date = customerReview.createdDate;
    }
    normalizedReviews.push(normalizedReview);
  }
  return normalizedReviews;
};

/** Normalize Google Play reviews to the aggregate's store-neutral fields. */
const normalizePlayReviews = (playReviews: readonly PlayReview[]): ReviewDatum[] => {
  const normalizedReviews: ReviewDatum[] = [];
  for (const playReview of playReviews) {
    const starRating = toStarRating(playReview.rating);
    if (starRating === null) continue;
    const normalizedReview: ReviewDatum = {
      store: 'play',
      rating: starRating,
      answered: playReview.answered,
    };
    if (playReview.lastModified !== undefined) normalizedReview.date = playReview.lastModified;
    normalizedReviews.push(normalizedReview);
  }
  return normalizedReviews;
};

/** Human label for a normalized store key. */
const storeLabel = (store: InsightsStore): string => {
  if (store === 'appstore') return 'App Store';
  return 'Play';
};

/** Build one fixed-width ASCII bar scaled against the largest rating bucket. */
const distributionBar = (count: number, maximum: number, width = 12): string => {
  let filled = 0;
  if (maximum > 0) filled = Math.round((count / maximum) * width);
  return '#'.repeat(filled) + '.'.repeat(width - filled);
};

/** Build one rating headline with average, volume, and answered rate. */
const ratingSummaryLine = (ratingSummary: RatingSummary): string => {
  const answeredPercentage = Math.round(ratingSummary.answeredRate * 100);
  let reviewNoun = 'reviews';
  if (ratingSummary.total === 1) reviewNoun = 'review';
  return `Rating ${ratingSummary.average.toFixed(1)}/5 - ${ratingSummary.total} ${reviewNoun} - ${answeredPercentage}% answered`;
};

/** Render the normalized insights report as one terminal block. */
export const renderInsights = (insightsReport: InsightsReport): string => {
  if (insightsReport.apps.length === 0) {
    return 'No review data - no selected app returned reviews from the App Store or Play.';
  }
  let appNoun = 'apps';
  if (insightsReport.apps.length === 1) appNoun = 'app';
  let reviewNoun = 'reviews';
  if (insightsReport.overall.total === 1) reviewNoun = 'review';
  const reportLines: string[] = [
    `Insights - ${insightsReport.apps.length} ${appNoun} - ${insightsReport.overall.total} ${reviewNoun}`,
  ];
  const descendingStars: readonly StarRating[] = [5, 4, 3, 2, 1];
  for (const appInsights of insightsReport.apps) {
    const maximumCount = Math.max(
      ...STARS.map((starRating) => appInsights.ratings.distribution[starRating]),
    );
    reportLines.push('', appInsights.app, `  ${ratingSummaryLine(appInsights.ratings)}`);
    for (const starRating of descendingStars) {
      const ratingCount = appInsights.ratings.distribution[starRating];
      reportLines.push(
        `  ${starRating} ${distributionBar(ratingCount, maximumCount)} ${ratingCount}`,
      );
    }
    reportLines.push(
      `  sentiment: ${appInsights.ratings.sentiment.positive} positive - ` +
        `${appInsights.ratings.sentiment.neutral} neutral - ${appInsights.ratings.sentiment.negative} negative`,
    );
    const stores: readonly InsightsStore[] = ['appstore', 'play'];
    const presentStores = stores.filter((store) => appInsights.byStore[store] !== undefined);
    if (presentStores.length > 1) {
      for (const store of presentStores) {
        const storeSummary = appInsights.byStore[store];
        if (storeSummary !== undefined) {
          reportLines.push(`  ${storeLabel(store)}: ${ratingSummaryLine(storeSummary)}`);
        }
      }
    }
    if (appInsights.trend.length > 0) {
      const trendPoints = appInsights.trend.map(
        (trendPoint) =>
          `${trendPoint.month} ${trendPoint.average.toFixed(1)} (${trendPoint.count})`,
      );
      reportLines.push(`  trend: ${trendPoints.join(' - ')}`);
    }
  }
  return reportLines.join('\n');
};

/** Read App Store reviews and degrade an unavailable store to a warning. */
const readAscInsights = (
  appDescriptor: AppDescriptor,
  ascClient: EffectAppStoreConnectClient | null,
  logger: Logger,
) => {
  if (appDescriptor.bundleId === undefined) return Effect.succeed<ReviewDatum[]>([]);
  if (ascClient === null) return Effect.succeed<ReviewDatum[]>([]);
  return listReviews(ascClient, appDescriptor.bundleId).pipe(
    Effect.map(normalizeAscReviews),
    Effect.catchAll((readFailure) =>
      logger
        .warn(`${appDescriptor.name}: App Store reviews unavailable - ${readFailure.message}`)
        .pipe(Effect.as<ReviewDatum[]>([])),
    ),
  );
};

/** Read Google Play reviews and degrade an unavailable store to a warning. */
const readPlayInsights = (
  appDescriptor: AppDescriptor,
  playClient: EffectGooglePlayClient | null,
  logger: Logger,
) => {
  if (appDescriptor.packageName === undefined) return Effect.succeed<ReviewDatum[]>([]);
  if (playClient === null) return Effect.succeed<ReviewDatum[]>([]);
  return playClient.listReviews(appDescriptor.packageName, {}).pipe(
    Effect.map(normalizePlayReviews),
    Effect.catchAll((readFailure) =>
      logger
        .warn(`${appDescriptor.name}: Play reviews unavailable - ${readFailure.message}`)
        .pipe(Effect.as<ReviewDatum[]>([])),
    ),
  );
};

/** Collect both stores' reviews for one app. */
const gatherAppReviews = (
  appDescriptor: AppDescriptor,
  ascClient: EffectAppStoreConnectClient | null,
  playClient: EffectGooglePlayClient | null,
  logger: Logger,
) =>
  Effect.all(
    [
      readAscInsights(appDescriptor, ascClient, logger),
      readPlayInsights(appDescriptor, playClient, logger),
    ],
    { concurrency: 'unbounded' },
  ).pipe(Effect.map(([ascReviews, playReviews]) => [...ascReviews, ...playReviews]));

/** Load, collect, aggregate, and render cross-store review insights. */
export const insightsCommandProgram = (commandOptions: InsightsCommandOptions) =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const resolveAscClient = createAscClientResolver();
    const resolvePlayClient = createPlayClientResolver();
    const [ascClient, playClient] = yield* Effect.all([resolveAscClient(), resolvePlayClient()], {
      concurrency: 'unbounded',
    });
    const selectedApps = yield* selectApps(loadedConfiguration.apps, commandOptions.app);
    const logger = yield* createLogger(false);
    const appReviews = yield* Effect.forEach(
      selectedApps,
      (appDescriptor) =>
        gatherAppReviews(appDescriptor, ascClient, playClient, logger).pipe(
          Effect.map((reviews) => ({ app: appDescriptor.name, reviews })),
        ),
      { concurrency: 'unbounded' },
    );
    const insightsReport = buildInsightsReport(
      appReviews.filter((appReviewSet) => appReviewSet.reviews.length > 0),
    );
    let reportText = renderInsights(insightsReport);
    if (commandOptions.json) reportText = JSON.stringify(insightsReport, null, 2);
    yield* logger.line(reportText);
  }).pipe(Effect.mapError((cause) => insightsFailure('collect review insights', cause)));
