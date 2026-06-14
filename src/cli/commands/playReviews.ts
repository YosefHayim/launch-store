/**
 * `launch play-reviews list|reply` — read Google Play customer reviews and manage the developer reply
 * from the CLI, using the Play service account alone (the local equivalent of the Play Console's "Reviews"
 * page). The Play twin of `launch reviews`.
 *
 * Thin glue over `core/playReviews.ts`: this file resolves the app + Play account, renders the output, and
 * guards the one outward-facing write (posting a public reply) behind a confirmation. Play exposes no
 * delete-reply endpoint, so there's no `delete` subcommand. Play returns only reviews with text from the
 * last ~week, and replies are limited to that window.
 */

import { readFileSync } from "node:fs";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { PlayReview } from "../../google/playClient.js";
import { GooglePlayClient, parseServiceAccount } from "../../google/playClient.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { listPlayReviews, replyToPlayReview, type PlayReviewFilters } from "../../core/playReviews.js";

/** Options for `play-reviews list`. */
interface PlayReviewsListOptions {
  app?: string;
  rating?: string;
  unanswered?: boolean;
  lang?: string;
  json?: boolean;
}

/** Options for posting a reply: the body (inline or from a file) plus the CI confirmation bypass. */
interface ReplyOptions {
  app?: string;
  message?: string;
  file?: string;
  yes?: boolean;
}

/** Build a Play client bound to the stored service account, or fail with the onboarding hint. */
async function activeClient(): Promise<GooglePlayClient> {
  const json = await loadServiceAccount();
  if (!json) throw new Error("No Play service account. Run `launch creds set-key --platform android` first.");
  return new GooglePlayClient(parseServiceAccount(json));
}

/** Resolve the selected app's Play package name, erroring when the app has none. */
async function resolvePackageName(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.packageName) {
    throw new Error(`No Android application id for ${app.name} (set android.package in app.json).`);
  }
  return app.packageName;
}

/** Parse + validate the `--rating` filter (1–5), or undefined when absent. Exported for unit tests. */
export function parseRating(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > 5) {
    throw new Error(`--rating must be a whole number 1–5 (got "${value}").`);
  }
  return Number(trimmed);
}

/** Collapse the list options into the {@link PlayReviewFilters} the core takes, omitting unset fields. */
function toFilters(options: PlayReviewsListOptions): PlayReviewFilters {
  const filters: PlayReviewFilters = {};
  const rating = parseRating(options.rating);
  if (rating !== undefined) filters.rating = rating;
  if (options.unanswered) filters.unansweredOnly = true;
  if (options.lang) filters.translationLanguage = options.lang;
  return filters;
}

/** Render one review as a copy-pasteable block: id, stars, meta line, then text + any existing reply. */
function renderReview(review: PlayReview): string {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const meta = [
    review.reviewerLanguage,
    review.lastModified ? review.lastModified.slice(0, 10) : undefined,
    review.appVersionName ? `v${review.appVersionName}` : undefined,
    review.authorName ? `by ${review.authorName}` : undefined,
    review.answered ? "✓ answered" : "• unanswered",
  ]
    .filter(Boolean)
    .join("  ");
  const lines = [`${review.reviewId}  ${stars} (${review.rating})`, `  ${meta}`];
  if (review.text) lines.push(`  ${review.text}`);
  if (review.developerReply) lines.push(`  ↳ reply: ${review.developerReply}`);
  return lines.join("\n");
}

/** Resolve the reply body from `--message` or `--file`, erroring when neither is given. */
function resolveBody(options: ReplyOptions): string {
  if (options.file) return readFileSync(options.file, "utf8").trim();
  if (options.message) return options.message;
  throw new Error("A reply body is required. Pass -m/--message <text> or --file <path>.");
}

/** Confirm an outward-facing write, refusing in CI unless `--yes` was passed. */
async function confirmWrite(message: string, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    throw new Error("Refusing to post without confirmation. Re-run with --yes (non-interactive).");
  }
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel("Aborted — nothing posted.");
    return false;
  }
  return true;
}

/** Attach the `play-reviews` command (with `list` / `reply` subcommands) to the program. */
export function registerPlayReviewsCommand(program: Command): void {
  const reviews = program
    .command("play-reviews")
    .description("read Google Play customer reviews and reply from the CLI");

  reviews
    .command("list")
    .description("list an app's Play reviews (only reviews with text from the last ~week)")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--rating <1-5>", "only show reviews with this star rating")
    .option("--unanswered", "only show reviews without a developer reply", false)
    .option("--lang <bcp47>", "machine-translate review text into this language (e.g. en-US)")
    .option("--json", "output machine-readable JSON", false)
    .action(async (options: PlayReviewsListOptions) => {
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();
      const found = await listPlayReviews(client, packageName, toFilters(options));

      if (options.json) {
        console.log(JSON.stringify(found, null, 2));
        return;
      }
      if (found.length === 0) {
        console.log("No reviews match. Try removing a filter, or check back later (Play shows only recent reviews).");
        return;
      }
      console.log(found.map(renderReview).join("\n\n"));
      console.log(`\n${found.length} review${found.length === 1 ? "" : "s"}.`);
    });

  reviews
    .command("reply")
    .description("post (or replace) the developer reply to a review")
    .argument("<reviewId>", "the review id from `play-reviews list`")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-m, --message <text>", "the reply text")
    .option("--file <path>", "read the reply text from a file")
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (reviewId: string, options: ReplyOptions) => {
      const log = createLogger(false);
      const body = resolveBody(options);
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();

      const existing = await client.getReview(packageName, reviewId);
      const verb = existing?.answered ? "Replace the existing reply to" : "Post a public reply to";
      if (!(await confirmWrite(`${verb} review ${reviewId}?`, options.yes))) return;

      const { result, replaced } = await replyToPlayReview(client, packageName, reviewId, body);
      log.step(
        replaced ? "reply replaced" : "reply posted",
        result.lastEdited ? `edited: ${result.lastEdited}` : undefined,
      );
    });
}
