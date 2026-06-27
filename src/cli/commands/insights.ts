/**
 * `launch insights` — the synthesis layer over the review/rating data Launch already pulls. Where
 * `reviews list` / `play-reviews list` dump individual reviews, insights aggregates them into the
 * trends a release manager actually watches: average rating, the per-star distribution, how much of the
 * inbox is answered, the sentiment split, and a month-by-month ratings line — across both stores at
 * once. This is Axis 4 of the differentiation roadmap (#178): no new data source, just the synthesis on
 * top of what `reviews` and `play-reviews` already retrieve.
 *
 * Thin glue: it resolves the read-only clients once, pulls each app's reviews, normalizes them to
 * {@link ReviewDatum}, and hands them to the pure aggregator in `core/insights`. All the numeric work
 * (and the renderer) is testable without a network. Read-only and informational — it never sets a
 * non-zero exit code; a store that can't be read is a warning, not a failure.
 */

import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { createLogger, type Logger } from '../../core/logger.js';
import { selectApps } from '../../core/syncJobs.js';
import { createAscClientResolver, createPlayClientResolver } from '../../core/storeClients.js';
import { listReviews } from '../../core/reviews.js';
import { listPlayReviews } from '../../core/playReviews.js';
import { buildInsightsReport, STARS } from '../../core/insights/aggregate.js';
import type { AppDescriptor } from '../../core/types.js';
import type { AscReviewsApi } from '../../core/reviews.js';
import type { PlayReviewsApi } from '../../core/playReviews.js';
import type {
  InsightsReport,
  InsightsStore,
  RatingSummary,
  ReviewDatum,
  StarRating,
} from '../../core/insights/types.js';

/** CLI options for `launch insights`. */
interface InsightsOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link InsightsReport}) for CI/agents. */
  json?: boolean;
}

/** Narrow a store-reported rating to the 1–5 star scale, dropping the 0/no-rating reviews Play emits. */
function toStar(rating: number): StarRating | null {
  if (rating === 1) return 1;
  if (rating === 2) return 2;
  if (rating === 3) return 3;
  if (rating === 4) return 4;
  if (rating === 5) return 5;
  return null;
}

/** One review's `unknown`-narrowed failure reason, matching the repo's inline catch idiom. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gather one app's reviews from every store it targets, normalized to {@link ReviewDatum}. Each store is
 * read independently and a read failure (no app record, missing scope) becomes a warning, not a throw —
 * insights should still report the stores that did respond.
 */
async function gatherReviews(
  app: AppDescriptor,
  asc: AscReviewsApi | null,
  play: PlayReviewsApi | null,
  log: Logger,
): Promise<ReviewDatum[]> {
  const data: ReviewDatum[] = [];

  if (app.bundleId && asc) {
    try {
      for (const review of await listReviews(asc, app.bundleId)) {
        const star = toStar(review.rating);
        if (!star) continue;
        const datum: ReviewDatum = { store: 'appstore', rating: star, answered: review.answered };
        if (review.createdDate) datum.date = review.createdDate;
        data.push(datum);
      }
    } catch (error) {
      log.warn(`${app.name}: App Store reviews unavailable — ${reason(error)}`);
    }
  }

  if (app.packageName && play) {
    try {
      for (const review of await listPlayReviews(play, app.packageName)) {
        const star = toStar(review.rating);
        if (!star) continue;
        const datum: ReviewDatum = { store: 'play', rating: star, answered: review.answered };
        if (review.lastModified) datum.date = review.lastModified;
        data.push(datum);
      }
    } catch (error) {
      log.warn(`${app.name}: Play reviews unavailable — ${reason(error)}`);
    }
  }

  return data;
}

/** Human label for a store key. */
function storeLabel(store: InsightsStore): string {
  return store === 'appstore' ? 'App Store' : 'Play';
}

/** A fixed-width bar for a distribution count, scaled against the largest bucket in the set. */
function bar(count: number, max: number, width = 12): string {
  const filled = max === 0 ? 0 : Math.round((count / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** The one-line headline for a rating summary: average, volume, answered rate. */
function summaryLine(summary: RatingSummary): string {
  const answeredPct = Math.round(summary.answeredRate * 100);
  const noun = summary.total === 1 ? 'review' : 'reviews';
  return `★ ${summary.average.toFixed(1)} avg · ${summary.total} ${noun} · ${answeredPct}% answered`;
}

/**
 * Render the full report as a scannable block (exported for unit tests). Empty report → a single
 * explanatory line. Each app shows its headline, the per-star distribution as bars, the sentiment
 * split, a per-store breakdown when it targets more than one store, and the monthly trend.
 */
export function renderInsights(report: InsightsReport): string {
  if (report.apps.length === 0) {
    return 'No review data — no selected app returned reviews from the App Store or Play.';
  }

  const appNoun = report.apps.length === 1 ? 'app' : 'apps';
  const reviewNoun = report.overall.total === 1 ? 'review' : 'reviews';
  const lines: string[] = [
    `Insights · ${report.apps.length} ${appNoun} · ${report.overall.total} ${reviewNoun}`,
  ];

  for (const app of report.apps) {
    const max = Math.max(...STARS.map((star) => app.ratings.distribution[star]));
    lines.push('', app.app, `  ${summaryLine(app.ratings)}`);
    for (let star = 5; star >= 1; star--) {
      const count = app.ratings.distribution[star as StarRating];
      lines.push(`  ${star} ${bar(count, max)} ${count}`);
    }
    lines.push(
      `  sentiment: ${app.ratings.sentiment.positive} positive · ` +
        `${app.ratings.sentiment.neutral} neutral · ${app.ratings.sentiment.negative} negative`,
    );

    const stores: InsightsStore[] = ['appstore', 'play'];
    const present = stores.filter((store) => app.byStore[store]);
    if (present.length > 1) {
      for (const store of present) {
        const summary = app.byStore[store];
        if (summary) lines.push(`  ${storeLabel(store)}: ${summaryLine(summary)}`);
      }
    }

    if (app.trend.length > 0) {
      const points = app.trend.map(
        (point) => `${point.month} ${point.average.toFixed(1)} (${point.count})`,
      );
      lines.push(`  trend: ${points.join(' · ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Run the insights flow. Exported so a test (or a future caller) can drive it directly: it loads the
 * config, resolves the read-only clients once, pulls each selected app's reviews, and renders the
 * aggregate. Stays at exit 0 — insights surfaces data, it doesn't gate.
 */
export async function runInsights(input: InsightsOptions): Promise<void> {
  const log = createLogger(false);
  const { apps } = await loadConfig();
  const selected = selectApps(apps, input.app);

  const asc = await createAscClientResolver()();
  const play = await createPlayClientResolver()();

  const perApp = await Promise.all(
    selected.map(async (app) => ({
      app: app.name,
      reviews: await gatherReviews(app, asc, play, log),
    })),
  );
  const report = buildInsightsReport(perApp.filter(({ reviews }) => reviews.length > 0));

  if (input.json === true) console.log(JSON.stringify(report, null, 2));
  else console.log(renderInsights(report));
}

/** Attach the top-level `insights` command to the program. */
export function registerInsightsCommand(program: Command): void {
  program
    .command('insights')
    .description('aggregate rating & review trends across the App Store and Play (read-only)')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: InsightsOptions) => {
      await runInsights(options);
    });
}
