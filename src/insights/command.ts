// Reads reviews from App Store Connect and Google Play, then prints the ratings report.

import { loadConfig } from '../config/config.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { AppStoreConnect } from '../apple/app-store-connect.ts';
import type { GooglePlayClient } from '../google/play-client.ts';
import { listReviews } from '../apple/reviews.ts';
import {
  createAscClientResolver,
  createPlayClientResolver,
} from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { CustomerReviewResource } from '../types/apple/customer-reviews.ts';
import type { PlayReview } from '../types/google/reviews.ts';
import type {
  InsightsReport,
  InsightsStore,
  RatingSummary,
  ReviewDatum,
  StarRating,
} from '../types/insights.ts';
import { buildInsightsReport, STARS } from './aggregate.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** Options accepted by the cross-store insights command. */
type InsightsCommandOptions = Readonly<{
  app?: string | undefined;
  json: boolean;
}>;

/** Loading or rendering cross-store review insights failed. */
type InsightsCommandFailure = Readonly<{
  readonly _tag: 'InsightsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function insightsFailure(operation: string, cause: unknown): InsightsCommandFailure {
  let message = `${operation} failed.`;

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return {
    _tag: 'InsightsCommandFailure',
    operation,
    message,
    cause,
  };
}

/** Narrow an external rating to Launch's one-to-five-star domain. */
function readStarRating(rating: number): StarRating | null {
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
}

/** Normalize App Store reviews to the aggregate's store-neutral fields. */
function normalizeAscReviews(customerReviews: readonly CustomerReviewResource[]): ReviewDatum[] {
  const normalizedReviews: ReviewDatum[] = [];

  for (const customerReview of customerReviews) {
    const starRating = readStarRating(customerReview.rating);

    if (starRating == null) continue;

    const normalizedReview: MutableDeep<ReviewDatum> = {
      store: 'appstore',
      rating: starRating,
      answered: customerReview.answered,
    };

    if (customerReview.createdDate != null) {
      normalizedReview.date = customerReview.createdDate;
    }

    normalizedReviews.push(normalizedReview);
  }

  return normalizedReviews;
}

/** Normalize Google Play reviews to the aggregate's store-neutral fields. */
function normalizePlayReviews(playReviews: readonly PlayReview[]): ReviewDatum[] {
  const normalizedReviews: ReviewDatum[] = [];

  for (const playReview of playReviews) {
    const starRating = readStarRating(playReview.rating);

    if (starRating == null) continue;

    const normalizedReview: MutableDeep<ReviewDatum> = {
      store: 'play',
      rating: starRating,
      answered: playReview.answered,
    };

    if (playReview.lastModified != null) normalizedReview.date = playReview.lastModified;

    normalizedReviews.push(normalizedReview);
  }

  return normalizedReviews;
}

/** Human label for a normalized store key. */
function storeLabel(store: InsightsStore): string {
  if (store == 'appstore') return 'App Store';

  return 'Play';
}

/** Build one fixed-width ASCII bar scaled against the largest rating bucket. */
function distributionBar(count: number, maximum: number, width: number = 12): string {
  let filled = 0;

  if (maximum > 0) filled = Math.round((count / maximum) * width);

  return '#'.repeat(filled) + '.'.repeat(width - filled);
}

/** Build one rating headline with average, volume, and answered rate. */
function ratingSummaryLine(ratingSummary: RatingSummary): string {
  const answeredPercentage = Math.round(ratingSummary.answeredRate * 100);
  let reviewNoun = 'reviews';

  if (ratingSummary.total == 1) reviewNoun = 'review';

  return `Rating ${ratingSummary.average.toFixed(1)}/5 - ${ratingSummary.total} ${reviewNoun} - ${answeredPercentage}% answered`;
}

/** Render the normalized insights report as one terminal block. */
export function renderInsights(insightsReport: InsightsReport): string {
  if (insightsReport.apps.length == 0) {
    return 'No review data - no selected app returned reviews from the App Store or Play.';
  }

  let appNoun = 'apps';

  if (insightsReport.apps.length == 1) appNoun = 'app';

  let reviewNoun = 'reviews';

  if (insightsReport.overall.total == 1) reviewNoun = 'review';

  const reportLines: string[] = [
    `Insights - ${insightsReport.apps.length} ${appNoun} - ${insightsReport.overall.total} ${reviewNoun}`,
  ];
  const descendingStars: readonly StarRating[] = [5, 4, 3, 2, 1];

  for (const appInsights of insightsReport.apps) {
    function readStarCount(starRating: 2 | 1 | 3 | 5 | 4) {
      return appInsights.ratings.distribution[starRating];
    }

    const maximumCount = Math.max(...STARS.map(readStarCount));

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

    function hasStoreRatings(store: 'appstore' | 'play') {
      return appInsights.byStore[store] != null;
    }

    const presentStores = stores.filter(hasStoreRatings);

    if (presentStores.length > 1) {
      for (const store of presentStores) {
        const storeSummary = appInsights.byStore[store];

        if (storeSummary != null) {
          reportLines.push(`  ${storeLabel(store)}: ${ratingSummaryLine(storeSummary)}`);
        }
      }
    }

    if (appInsights.trend.length > 0) {
      function writeTrendLine(trendPoint: {
        readonly month: string;
        readonly count: number;
        readonly average: number;
      }) {
        return `${trendPoint.month} ${trendPoint.average.toFixed(1)} (${trendPoint.count})`;
      }

      const trendPoints = appInsights.trend.map(writeTrendLine);

      reportLines.push(`  trend: ${trendPoints.join(' - ')}`);
    }
  }

  return reportLines.join('\n');
}

function reviewFailureMessage(readFailure: unknown): string {
  const hasFailureMessage = hasMessage(readFailure);

  if (hasFailureMessage) {
    return readFailure.message;
  }

  return 'request failed';
}

/** Read App Store reviews and degrade an unavailable store to a warning. */
async function readAscInsights(
  appDescriptor: AppDescriptor,
  ascClient: AppStoreConnect | null,
  logger: Logger,
): Promise<ReviewDatum[]> {
  const bundleId = appDescriptor.bundleId;

  const hasNoBundleId = bundleId == null;

  if (hasNoBundleId) {
    return [];
  }

  const isAscMissing = ascClient == null;

  if (isAscMissing) {
    return [];
  }

  try {
    const customerReviews = await listReviews(ascClient, bundleId);
    return normalizeAscReviews(customerReviews);
  } catch (readFailure) {
    logger.warn(
      `${appDescriptor.name}: App Store reviews unavailable - ${reviewFailureMessage(readFailure)}`,
    );
    return [];
  }
}

/** Read Google Play reviews and degrade an unavailable store to a warning. */
async function readPlayInsights(
  appDescriptor: AppDescriptor,
  playClient: GooglePlayClient | null,
  logger: Logger,
): Promise<ReviewDatum[]> {
  const packageName = appDescriptor.packageName;

  const hasNoPackageName = packageName == null;

  if (hasNoPackageName) {
    return [];
  }

  const isPlayMissing = playClient == null;

  if (isPlayMissing) {
    return [];
  }

  try {
    const playReviews = await playClient.listReviews(packageName, {});
    return normalizePlayReviews(playReviews);
  } catch (readFailure) {
    logger.warn(
      `${appDescriptor.name}: Play reviews unavailable - ${reviewFailureMessage(readFailure)}`,
    );
    return [];
  }
}

/** Collect both stores' reviews for one app. */
async function gatherAppReviews(
  appDescriptor: AppDescriptor,
  ascClient: AppStoreConnect | null,
  playClient: GooglePlayClient | null,
  logger: Logger,
): Promise<ReviewDatum[]> {
  const ascReviewsPromise = readAscInsights(appDescriptor, ascClient, logger);
  const playReviewsPromise = readPlayInsights(appDescriptor, playClient, logger);
  const ascReviews = await ascReviewsPromise;
  const playReviews = await playReviewsPromise;

  return [...ascReviews, ...playReviews];
}

function hasCollectedReviews(appReviewSet: { reviews: readonly ReviewDatum[] }): boolean {
  return appReviewSet.reviews.length > 0;
}

/** Load, collect, aggregate, and render cross-store review insights. */
export async function insightsCommandProgram(
  commandOptions: InsightsCommandOptions,
): Promise<void> {
  try {
    const launchDirectories = readLaunchDirectories();
    const loadedConfiguration = await loadConfig(launchDirectories.workingDirectory);
    const resolveAscClient = createAscClientResolver();
    const resolvePlayClient = createPlayClientResolver();
    const ascClient = await resolveAscClient();
    const selectedApps = await selectApps(loadedConfiguration.apps, commandOptions.app);
    const logger = createLogger(false);

    async function collectAppReviews(appDescriptor: AppDescriptor): Promise<{
      app: string;
      reviews: ReviewDatum[];
    }> {
      const playClient = await resolvePlayClient(appDescriptor.packageName);
      const reviews = await gatherAppReviews(appDescriptor, ascClient, playClient, logger);

      return { app: appDescriptor.name, reviews };
    }

    const appReviews = await Promise.all(selectedApps.map(collectAppReviews));
    const insightsReport = buildInsightsReport(appReviews.filter(hasCollectedReviews));
    let reportText = renderInsights(insightsReport);

    const isJsonReport = commandOptions.json == true;

    if (isJsonReport) {
      reportText = JSON.stringify(insightsReport, null, 2);
    }

    logger.line(reportText);
  } catch (cause) {
    throw insightsFailure('collect review insights', cause);
  }
}
