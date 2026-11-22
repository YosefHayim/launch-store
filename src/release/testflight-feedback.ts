import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../types/apple-catalog.ts';
import type { BetaFeedback, BetaFeedbackKind } from '../types/app.ts';

export type AscFeedbackApi = Readonly<{
  readonly getAppId: (bundleId: string) => Promise<string | null>;
  readonly findBuildByVersion: (
    appId: string,
    buildNumber: number,
  ) => Promise<BuildResource | null>;
  readonly listBetaFeedbackCrashSubmissions: (
    appId: string,
    query: BetaFeedbackQuery,
  ) => Promise<BetaFeedbackCrashSubmissionResource[]>;
  readonly listBetaFeedbackScreenshotSubmissions: (
    appId: string,
    query: BetaFeedbackQuery,
  ) => Promise<BetaFeedbackScreenshotSubmissionResource[]>;
  readonly downloadBetaFeedbackScreenshot: (url: string) => Promise<Buffer>;
}>;

export type FeedbackFilters = Readonly<{
  readonly build?: string;
  readonly kind?: BetaFeedbackKind;
}>;

type DownloadedAttachment = Readonly<{
  readonly path: string;
  readonly url: string;
}>;

type TestflightFeedbackFailure = Readonly<{
  readonly _tag: 'TestflightFeedbackFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeTestflightFeedbackFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): TestflightFeedbackFailure {
  if (fields.cause == null) {
    return {
      _tag: 'TestflightFeedbackFailure',
      operation: fields.operation,
      message: fields.message,
    };
  }

  return {
    _tag: 'TestflightFeedbackFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

/** Look up a numeric CFBundleVersion and return its App Store build resource id. */
async function buildIdForVersion(
  appleStore: AscFeedbackApi,
  appId: string,
  buildVersion: string,
): Promise<string> {
  const normalizedVersion = buildVersion.trim();
  // A CFBundleVersion here is digits only, with no sign or decimal point.
  const isWholeNumber = /^\d+$/.test(normalizedVersion);

  if (isWholeNumber == false) {
    throw makeTestflightFeedbackFailure({
      operation: 'find TestFlight build',
      message: `--build must be a CFBundleVersion (a whole number), got "${buildVersion}".`,
    });
  }

  const buildNumber = Number.parseInt(normalizedVersion, 10);
  const matchedBuild = await appleStore.findBuildByVersion(appId, buildNumber);
  const isBuildMissing = matchedBuild == null;

  if (isBuildMissing) {
    throw makeTestflightFeedbackFailure({
      operation: 'find TestFlight build',
      message: `No build ${buildVersion} for this app. Check the build number with \`launch status\`.`,
    });
  }

  return matchedBuild.id;
}

async function readCrashSubmissions(
  appleStore: AscFeedbackApi,
  appId: string,
  query: BetaFeedbackQuery,
  kind: BetaFeedbackKind | undefined,
): Promise<BetaFeedbackCrashSubmissionResource[]> {
  const skipCrashRead = kind == 'screenshot';

  if (skipCrashRead) {
    return [];
  }

  return appleStore.listBetaFeedbackCrashSubmissions(appId, query);
}

async function readScreenshotSubmissions(
  appleStore: AscFeedbackApi,
  appId: string,
  query: BetaFeedbackQuery,
  kind: BetaFeedbackKind | undefined,
): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
  const skipScreenshotRead = kind == 'crash';

  if (skipScreenshotRead) {
    return [];
  }

  return appleStore.listBetaFeedbackScreenshotSubmissions(appId, query);
}

function createdDateText(feedbackEntry: BetaFeedback): string {
  if (feedbackEntry.createdDate == null) {
    return '';
  }

  return feedbackEntry.createdDate;
}

function compareCreatedDateDescending(leftEntry: BetaFeedback, rightEntry: BetaFeedback): number {
  const leftDate = createdDateText(leftEntry);
  const rightDate = createdDateText(rightEntry);
  return rightDate.localeCompare(leftDate);
}

/** List normalized TestFlight feedback, optionally narrowed by build and feedback kind. */
export async function listBetaFeedback(
  appleStore: AscFeedbackApi,
  bundleId: string,
  filters: FeedbackFilters = {},
): Promise<BetaFeedback[]> {
  const appId = await appleStore.getAppId(bundleId);
  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw makeTestflightFeedbackFailure({
      operation: 'find App Store app',
      message: `No App Store Connect app record for ${bundleId}. Confirm the bundle id and active account access.`,
    });
  }

  let query: BetaFeedbackQuery = {};
  const buildFilter = filters.build;
  const hasBuildFilter = buildFilter != null;

  if (hasBuildFilter) {
    const buildId = await buildIdForVersion(appleStore, appId, buildFilter);
    query = { buildId };
  }

  const crashRead = readCrashSubmissions(appleStore, appId, query, filters.kind);
  const screenshotRead = readScreenshotSubmissions(appleStore, appId, query, filters.kind);
  const crashSubmissions = await crashRead;
  const screenshotSubmissions = await screenshotRead;
  const feedbackEntries: BetaFeedback[] = [];

  for (const crashSubmission of crashSubmissions) {
    feedbackEntries.push({ ...crashSubmission, kind: 'crash' });
  }

  for (const screenshotSubmission of screenshotSubmissions) {
    const { screenshots, ...submissionDetails } = screenshotSubmission;
    const hasNoScreenshots = screenshots.length == 0;

    if (hasNoScreenshots) {
      feedbackEntries.push({ ...submissionDetails, kind: 'screenshot' });
      continue;
    }

    feedbackEntries.push({
      ...submissionDetails,
      kind: 'screenshot',
      screenshots,
    });
  }

  feedbackEntries.sort(compareCreatedDateDescending);
  return feedbackEntries;
}

/** Convert an unexpected feedback id into a collision-resistant path segment. */
function safeFeedbackIdentifier(feedbackId: string): string {
  // Path-safe characters only: letters, digits, underscore, and hyphen.
  const isPathSafe = /^[A-Za-z0-9_-]+$/.test(feedbackId);

  if (isPathSafe) {
    return feedbackId;
  }

  return Buffer.from(feedbackId, 'utf8').toString('base64url');
}

/** Download screenshot attachments serially into one directory. */
export async function downloadFeedbackAttachments(
  appleStore: AscFeedbackApi,
  feedbackEntries: readonly BetaFeedback[],
  outputDirectory: string,
): Promise<DownloadedAttachment[]> {
  await mkdir(outputDirectory, { recursive: true });
  const downloadedAttachments: DownloadedAttachment[] = [];

  for (const feedbackEntry of feedbackEntries) {
    const listedScreenshots = feedbackEntry.screenshots;
    const hasNoScreenshots = listedScreenshots == null;

    if (hasNoScreenshots) {
      continue;
    }

    const safeIdentifier = safeFeedbackIdentifier(feedbackEntry.id);

    for (const [screenshotIndex, screenshot] of listedScreenshots.entries()) {
      const screenshotBytes = await appleStore.downloadBetaFeedbackScreenshot(screenshot.url);
      const firstAttachmentNumber = 1;
      const attachmentNumber = screenshotIndex + firstAttachmentNumber;
      const attachmentPath = join(outputDirectory, `${safeIdentifier}-${attachmentNumber}.png`);
      await writeFile(attachmentPath, screenshotBytes);
      downloadedAttachments.push({ path: attachmentPath, url: screenshot.url });
    }
  }

  return downloadedAttachments;
}
