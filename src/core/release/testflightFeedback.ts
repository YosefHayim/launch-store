import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../types/appleCatalog.js';
import type { BetaFeedback, BetaFeedbackKind } from '../types/app.js';

export type AscFeedbackApi = Readonly<{
  readonly getAppId: (bundleId: string) => Effect.Effect<string | null, unknown>;
  readonly findBuildByVersion: (
    appId: string,
    buildNumber: number,
  ) => Effect.Effect<BuildResource | null, unknown>;
  readonly listBetaFeedbackCrashSubmissions: (
    appId: string,
    query: BetaFeedbackQuery,
  ) => Effect.Effect<BetaFeedbackCrashSubmissionResource[], unknown>;
  readonly listBetaFeedbackScreenshotSubmissions: (
    appId: string,
    query: BetaFeedbackQuery,
  ) => Effect.Effect<BetaFeedbackScreenshotSubmissionResource[], unknown>;
  readonly downloadBetaFeedbackScreenshot: (url: string) => Effect.Effect<Buffer, unknown>;
}>;

export type FeedbackFilters = Readonly<{
  readonly build?: string;
  readonly kind?: BetaFeedbackKind;
}>;

export type DownloadedAttachment = Readonly<{
  readonly path: string;
  readonly url: string;
}>;

export type TestflightFeedbackFailure = Readonly<{
  readonly _tag: 'TestflightFeedbackFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeTestflightFeedbackFailure = Data.tagged<TestflightFeedbackFailure>(
  'TestflightFeedbackFailure',
);

/** Resolve a numeric CFBundleVersion to its App Store build resource id. */
const resolveBuildId = (
  appleStore: AscFeedbackApi,
  appId: string,
  buildVersion: string,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const normalizedVersion = buildVersion.trim();
    if (!/^\d+$/.test(normalizedVersion)) {
      return yield* Effect.fail(
        makeTestflightFeedbackFailure({
          operation: 'resolve TestFlight build',
          message: `--build must be a CFBundleVersion (a whole number), got "${buildVersion}".`,
        }),
      );
    }
    const buildNumber = Number.parseInt(normalizedVersion, 10);
    const matchedBuild = yield* appleStore.findBuildByVersion(appId, buildNumber);
    if (matchedBuild !== null) return matchedBuild.id;
    return yield* Effect.fail(
      makeTestflightFeedbackFailure({
        operation: 'resolve TestFlight build',
        message: `No build ${buildVersion} for this app. Check the build number with \`launch status\`.`,
      }),
    );
  });

/** List normalized TestFlight feedback, optionally narrowed by build and feedback kind. */
export const listBetaFeedback = (
  appleStore: AscFeedbackApi,
  bundleId: string,
  filters: FeedbackFilters = {},
): Effect.Effect<BetaFeedback[], unknown> =>
  Effect.gen(function* () {
    const appId = yield* appleStore.getAppId(bundleId);
    if (appId === null) {
      return yield* Effect.fail(
        makeTestflightFeedbackFailure({
          operation: 'find App Store app',
          message: `No App Store Connect app record for ${bundleId}. Confirm the bundle id and active account access.`,
        }),
      );
    }
    let query: BetaFeedbackQuery = {};
    if (filters.build !== undefined) {
      query = { buildId: yield* resolveBuildId(appleStore, appId, filters.build) };
    }
    let crashRead: Effect.Effect<BetaFeedbackCrashSubmissionResource[], unknown> = Effect.succeed(
      [],
    );
    if (filters.kind !== 'screenshot') {
      crashRead = appleStore.listBetaFeedbackCrashSubmissions(appId, query);
    }
    let screenshotRead: Effect.Effect<BetaFeedbackScreenshotSubmissionResource[], unknown> =
      Effect.succeed([]);
    if (filters.kind !== 'crash') {
      screenshotRead = appleStore.listBetaFeedbackScreenshotSubmissions(appId, query);
    }
    const [crashSubmissions, screenshotSubmissions] = yield* Effect.all(
      [crashRead, screenshotRead] as const,
      { concurrency: 2 },
    );
    const feedbackEntries: BetaFeedback[] = [];
    for (const crashSubmission of crashSubmissions) {
      feedbackEntries.push({ ...crashSubmission, kind: 'crash' });
    }
    for (const screenshotSubmission of screenshotSubmissions) {
      const { screenshots, ...submissionDetails } = screenshotSubmission;
      if (screenshots.length === 0) {
        feedbackEntries.push({ ...submissionDetails, kind: 'screenshot' });
        continue;
      }
      feedbackEntries.push({ ...submissionDetails, kind: 'screenshot', screenshots });
    }
    return feedbackEntries.sort((leftEntry, rightEntry) => {
      let leftDate = '';
      if (leftEntry.createdDate !== undefined) leftDate = leftEntry.createdDate;
      let rightDate = '';
      if (rightEntry.createdDate !== undefined) rightDate = rightEntry.createdDate;
      return rightDate.localeCompare(leftDate);
    });
  });

/** Convert an unexpected feedback id into a collision-resistant path segment. */
const safeFeedbackIdentifier = (feedbackId: string): string => {
  if (/^[A-Za-z0-9_-]+$/.test(feedbackId)) return feedbackId;
  return Buffer.from(feedbackId, 'utf8').toString('base64url');
};

/** Download screenshot attachments serially into one directory. */
export const downloadFeedbackAttachments = (
  appleStore: AscFeedbackApi,
  feedbackEntries: BetaFeedback[],
  outputDirectory: string,
): Effect.Effect<DownloadedAttachment[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fileSystem.makeDirectory(outputDirectory, { recursive: true });
    const downloadedAttachments: DownloadedAttachment[] = [];
    for (const feedbackEntry of feedbackEntries) {
      let screenshots = feedbackEntry.screenshots;
      if (screenshots === undefined) screenshots = [];
      const safeIdentifier = safeFeedbackIdentifier(feedbackEntry.id);
      for (const [screenshotIndex, screenshot] of screenshots.entries()) {
        const screenshotBytes = yield* appleStore.downloadBetaFeedbackScreenshot(screenshot.url);
        const attachmentPath = pathService.join(
          outputDirectory,
          `${safeIdentifier}-${screenshotIndex + 1}.png`,
        );
        yield* fileSystem.writeFile(attachmentPath, screenshotBytes);
        downloadedAttachments.push({ path: attachmentPath, url: screenshot.url });
      }
    }
    return downloadedAttachments;
  });
