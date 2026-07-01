/**
 * The `launch testflight feedback` domain: read a TestFlight build's tester feedback — crash reports
 * and screenshot submissions — and optionally download the screenshot attachments, entirely through
 * the App Store Connect API key (no portal, no web session).
 *
 * Design:
 * - **Stateless & read-first.** Every call reads the live account; there's no local cache to drift.
 *   {@link listBetaFeedback} resolves the app record from its bundle id, resolves a `--build <ver>` to
 *   its build *resource id* (Apple's `filter[build]` keys on the id, not the version string), fetches
 *   the requested kind(s), and normalizes Apple's two separate resources into one {@link BetaFeedback}
 *   list sorted newest-first.
 * - **Download is a separate, explicit step.** Listing never touches disk; {@link downloadFeedbackAttachments}
 *   is only invoked when the command passes `--out`, mirroring how `launch reports` separates the API
 *   walk from the file writes.
 *
 * The {@link AscFeedbackApi} slice mirrors `core/reviews.ts`'s `AscReviewsApi`: it names the exact
 * client surface this module needs, so the logic is unit-testable with a hand-rolled fake and
 * `AppStoreConnectClient` satisfies it structurally.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../apple/ascClient.js';
import { appRecordNotFound } from './asc/storeSync.js';
import { ensureDir } from './paths.js';
import type { BetaFeedback, BetaFeedbackKind } from './types.js';

/** The exact slice of {@link AppStoreConnectClient} the testflight-feedback domain depends on. */
export interface AscFeedbackApi {
  getAppId(bundleId: string): Promise<string | null>;
  findBuildByVersion(appId: string, buildNumber: number): Promise<BuildResource | null>;
  listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery,
  ): Promise<BetaFeedbackCrashSubmissionResource[]>;
  listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery,
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]>;
  downloadBetaFeedbackScreenshot(url: string): Promise<Buffer>;
}

/** Filters for {@link listBetaFeedback}. `build` is a `CFBundleVersion`; `kind` narrows to one feedback kind. */
export interface FeedbackFilters {
  /** Keep only feedback for this build (`CFBundleVersion`, e.g. `42`). */
  build?: string;
  /** Keep only this kind of feedback; both kinds are returned when unset. */
  kind?: BetaFeedbackKind;
}

/** One downloaded screenshot: where it was written, and the source presigned URL it came from. */
export interface DownloadedAttachment {
  /** Absolute or `outDir`-relative path the image was written to. */
  path: string;
  /** The presigned source URL the image was fetched from. */
  url: string;
}

/** Resolve a `--build <ver>` to its build resource id, erroring when no such build exists on the app. */
async function resolveBuildId(
  api: AscFeedbackApi,
  appId: string,
  version: string,
): Promise<string> {
  const parsed = Number.parseInt(version.trim(), 10);
  if (!/^\d+$/.test(version.trim()) || Number.isNaN(parsed)) {
    throw new Error(`--build must be a CFBundleVersion (a whole number), got "${version}".`);
  }
  const build = await api.findBuildByVersion(appId, parsed);
  if (!build)
    throw new Error(
      `No build ${version} for this app. Check the build number with \`launch status\`.`,
    );
  return build.id;
}

/**
 * List a TestFlight app's tester feedback (newest first), narrowed by the given filters. Resolves the
 * ASC app record from the bundle id first, then a `--build` to its resource id, then fetches the
 * requested kind(s) and merges them into one chronologically-sorted list of {@link BetaFeedback}.
 */
export async function listBetaFeedback(
  api: AscFeedbackApi,
  bundleId: string,
  filters: FeedbackFilters = {},
): Promise<BetaFeedback[]> {
  const appId = await api.getAppId(bundleId);
  if (!appId) throw appRecordNotFound(bundleId);

  const query: BetaFeedbackQuery = filters.build
    ? { buildId: await resolveBuildId(api, appId, filters.build) }
    : {};

  // Fetch both kinds concurrently; skip a kind entirely when `--type` narrows to the other.
  const [crashes, shots] = await Promise.all([
    filters.kind !== 'screenshot'
      ? api.listBetaFeedbackCrashSubmissions(appId, query)
      : Promise.resolve<BetaFeedbackCrashSubmissionResource[]>([]),
    filters.kind !== 'crash'
      ? api.listBetaFeedbackScreenshotSubmissions(appId, query)
      : Promise.resolve<BetaFeedbackScreenshotSubmissionResource[]>([]),
  ]);

  const feedback: BetaFeedback[] = [];
  for (const crash of crashes) {
    feedback.push({ ...crash, kind: 'crash' });
  }
  for (const shot of shots) {
    const { screenshots, ...base } = shot;
    feedback.push({
      ...base,
      kind: 'screenshot',
      ...(screenshots.length > 0 ? { screenshots } : {}),
    });
  }

  // Both kinds come back newest-first individually; merging them needs one more sort to interleave.
  return feedback.sort((a, b) => (b.createdDate ?? '').localeCompare(a.createdDate ?? ''));
}

/**
 * Download every screenshot attached to the given feedback into `outDir`, returning what was written.
 * Files are named `<feedbackId>-<n>.png` (a feedback can carry several screenshots), so a re-run
 * overwrites in place rather than duplicating; a non-path-safe id is base64url-encoded first (see
 * below). Crash feedback has no attachments and is skipped.
 */
export async function downloadFeedbackAttachments(
  api: AscFeedbackApi,
  feedback: BetaFeedback[],
  outDir: string,
): Promise<DownloadedAttachment[]> {
  ensureDir(outDir);
  const written: DownloadedAttachment[] = [];
  for (const item of feedback) {
    const shots = item.screenshots ?? [];
    // Keep the id out of the filesystem unless it's already path-safe. Apple ids are; an unexpected
    // one is base64url-encoded rather than stripped, so two distinct ids can't collapse to the same
    // filename and overwrite each other's screenshots.
    const safeId = /^[A-Za-z0-9_-]+$/.test(item.id)
      ? item.id
      : Buffer.from(item.id, 'utf8').toString('base64url');
    for (const [index, shot] of shots.entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: serial downloads — the store endpoint rate-limits, so files/attachments are fetched one at a time
      const bytes = await api.downloadBetaFeedbackScreenshot(shot.url);
      const path = join(outDir, `${safeId}-${index + 1}.png`);
      writeFileSync(path, bytes);
      written.push({ path, url: shot.url });
    }
  }
  return written;
}
