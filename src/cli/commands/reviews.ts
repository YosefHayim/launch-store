/**
 * `launch reviews list|reply|delete` — read App Store customer reviews and manage the developer
 * response from the CLI, using the App Store Connect API key alone (the local equivalent of clicking
 * through the "Ratings and Reviews" page; EAS has no equivalent at all).
 *
 * Thin glue over `core/reviews.ts`: this file resolves the account + app, renders the output, and
 * guards the one outward-facing write (posting a public reply) behind a confirmation. All review
 * logic and request shaping live in the core module and the ASC client.
 */

import { readFileSync } from "node:fs";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { CustomerReviewResource } from "../../apple/ascClient.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import { deleteReviewResponse, listReviews, replyToReview, type ReviewFilters } from "../../core/reviews.js";

/** Options shared by every subcommand that targets an app's reviews. */
interface ReviewsListOptions {
  app?: string;
  rating?: string;
  territory?: string;
  unanswered?: boolean;
  json?: boolean;
}

/** Options for posting a reply: the body (inline or from a file) plus the CI confirmation bypass. */
interface ReplyOptions {
  message?: string;
  file?: string;
  yes?: boolean;
}

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app's iOS bundle id, erroring when the app has none. */
async function resolveBundleId(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(`No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`);
  }
  return app.bundleId;
}

/** Parse + validate the `--rating` filter (1–5), or undefined when absent. Exported for unit tests. */
export function parseRating(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  // Require all-digits: `Number.parseInt("3x")` would silently accept "3x" as 3 and filter wrongly.
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > 5) {
    throw new Error(`--rating must be a whole number 1–5 (got "${value}").`);
  }
  return Number(trimmed);
}

/** Collapse the list options into the {@link ReviewFilters} the core takes, omitting unset fields. */
function toFilters(options: ReviewsListOptions): ReviewFilters {
  const filters: ReviewFilters = {};
  const rating = parseRating(options.rating);
  if (rating !== undefined) filters.rating = rating;
  if (options.territory) filters.territory = options.territory;
  if (options.unanswered) filters.unansweredOnly = true;
  return filters;
}

/** Trim an ISO-8601 timestamp to its `YYYY-MM-DD` date for display. */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Render one review as a copy-pasteable block: id, stars, meta line, then title + body. */
function renderReview(review: CustomerReviewResource): string {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const meta = [
    review.territory,
    review.createdDate ? formatDate(review.createdDate) : undefined,
    review.reviewerNickname ? `by ${review.reviewerNickname}` : undefined,
    review.answered ? "✓ answered" : "• unanswered",
  ]
    .filter(Boolean)
    .join("  ");
  const lines = [`${review.id}  ${stars} (${review.rating})`, `  ${meta}`];
  if (review.title) lines.push(`  "${review.title}"`);
  if (review.body) lines.push(`  ${review.body}`);
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

/** Attach the `reviews` command (with `list` / `reply` / `delete` subcommands) to the program. */
export function registerReviewsCommand(program: Command): void {
  const reviews = program.command("reviews").description("read App Store customer reviews and reply from the CLI");

  reviews
    .command("list")
    .description("list an app's customer reviews, newest first")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--rating <1-5>", "only show reviews with this star rating")
    .option("--territory <code>", "only show reviews from this territory (e.g. USA)")
    .option("--unanswered", "only show reviews without a developer response", false)
    .option("--json", "output machine-readable JSON", false)
    .action(async (options: ReviewsListOptions) => {
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();
      const found = await listReviews(client, bundleId, toFilters(options));

      if (options.json) {
        console.log(JSON.stringify(found, null, 2));
        return;
      }
      if (found.length === 0) {
        console.log("No reviews match. Try removing a filter, or check back later.");
        return;
      }
      console.log(found.map(renderReview).join("\n\n"));
      console.log(`\n${found.length} review${found.length === 1 ? "" : "s"}.`);
    });

  reviews
    .command("reply")
    .description("post (or replace) the developer response to a review")
    .argument("<reviewId>", "the review id from `reviews list`")
    .option("-m, --message <text>", "the reply text")
    .option("--file <path>", "read the reply text from a file")
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (reviewId: string, options: ReplyOptions) => {
      const log = createLogger(false);
      const body = resolveBody(options);
      const client = await activeClient();

      const existing = await client.getCustomerReviewResponse(reviewId);
      const verb = existing ? "Replace the existing reply to" : "Post a public reply to";
      if (!(await confirmWrite(`${verb} review ${reviewId}?`, options.yes))) return;

      const { response, replaced } = await replyToReview(client, reviewId, body);
      log.step(replaced ? "reply replaced" : "reply posted", response.state ? `state: ${response.state}` : undefined);
    });

  reviews
    .command("delete")
    .description("delete the developer response to a review")
    .argument("<reviewId>", "the review id from `reviews list`")
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (reviewId: string, options: { yes?: boolean }) => {
      const log = createLogger(false);
      const client = await activeClient();
      if (!(await confirmWrite(`Delete the developer response to review ${reviewId}?`, options.yes))) return;

      const deleted = await deleteReviewResponse(client, reviewId);
      if (deleted) log.step("reply deleted", reviewId);
      else log.info(`No developer response on review ${reviewId} — nothing to delete.`);
    });
}
