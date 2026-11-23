import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../types/apple-catalog.ts';
import type { BetaFeedback } from '../types/app.ts';
import {
  type AscFeedbackApi,
  downloadFeedbackAttachments,
  listBetaFeedback,
} from './testflight-feedback.ts';

type AppleStoreOptions = Readonly<{
  appIds?: Record<string, string>;
  crashSubmissions?: BetaFeedbackCrashSubmissionResource[];
  screenshotSubmissions?: BetaFeedbackScreenshotSubmissionResource[];
  builds?: Record<number, BuildResource>;
  screenshotBytes?: Buffer;
}>;

function makeAppleStore(options: AppleStoreOptions): AscFeedbackApi {
  return {
    getAppId: vi.fn(function readAppId(bundleId: string) {
      const appId = options.appIds?.[bundleId];

      if (appId == null) {
        return Promise.resolve(null);
      }

      return Promise.resolve(appId);
    }),
    findBuildByVersion: vi.fn(function readBuild(_appId: string, buildNumber: number) {
      const matchedBuild = options.builds?.[buildNumber];

      if (matchedBuild == null) {
        return Promise.resolve(null);
      }

      return Promise.resolve(matchedBuild);
    }),
    listBetaFeedbackCrashSubmissions: vi.fn(function readCrashes() {
      if (options.crashSubmissions == null) {
        return Promise.resolve([]);
      }

      return Promise.resolve(options.crashSubmissions);
    }),
    listBetaFeedbackScreenshotSubmissions: vi.fn(function readScreenshots() {
      if (options.screenshotSubmissions == null) {
        return Promise.resolve([]);
      }

      return Promise.resolve(options.screenshotSubmissions);
    }),
    downloadBetaFeedbackScreenshot: vi.fn(function readScreenshotBytes() {
      if (options.screenshotBytes == null) {
        const bufferBytes = Buffer.from('png');
        return Promise.resolve(bufferBytes);
      }

      return Promise.resolve(options.screenshotBytes);
    }),
  };
}

function describeListBetaFeedback() {
  async function failsClearlyWhenTheAppPieceIsMissing() {
    const appleStore = makeAppleStore({ appIds: {} });

    const betaFeedback = listBetaFeedback(appleStore, 'com.x.missing');

    await expect(betaFeedback).rejects.toMatchObject({
      _tag: 'TestflightFeedbackFailure',
      message: expect.stringContaining('No App Store Connect app record'),
    });
  }

  it('fails clearly when the app record is missing', failsClearlyWhenTheAppPieceIsMissing);

  async function mergesCrashAndScreenshotFeedbackNewestFirst() {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      crashSubmissions: [{ id: 'c1', createdDate: '2026-06-18T00:00:00Z', comment: 'crash' }],
      screenshotSubmissions: [
        {
          id: 's1',
          createdDate: '2026-06-20T00:00:00Z',
          screenshots: [{ url: 'https://a/1.png' }],
        },
      ],
    });

    const feedbackEntries = await listBetaFeedback(appleStore, 'com.x');

    expect(
      feedbackEntries.map(function feedbackId(feedbackEntry) {
        return feedbackEntry.id;
      }),
    ).toEqual(['s1', 'c1']);
    expect(
      feedbackEntries.find(function crashEntry(feedbackEntry) {
        return feedbackEntry.id == 'c1';
      })?.kind,
    ).toBe('crash');

    const screenshotFeedback = feedbackEntries.find(function screenshotEntry(feedbackEntry) {
      return feedbackEntry.id == 's1';
    });

    expect(screenshotFeedback?.kind).toBe('screenshot');
    expect(screenshotFeedback?.screenshots).toEqual([{ url: 'https://a/1.png' }]);
  }

  it(
    'merges crash and screenshot feedback newest-first',
    mergesCrashAndScreenshotFeedbackNewestFirst,
  );

  async function skipsScreenshotReadsWhenCrashFeedbackIsRequested() {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      crashSubmissions: [{ id: 'c1' }],
    });

    const feedbackEntries = await listBetaFeedback(appleStore, 'com.x', { kind: 'crash' });

    expect(
      feedbackEntries.map(function feedbackId(feedbackEntry) {
        return feedbackEntry.id;
      }),
    ).toEqual(['c1']);
    expect(appleStore.listBetaFeedbackScreenshotSubmissions).not.toHaveBeenCalled();
  }

  it(
    'skips screenshot reads when crash feedback is requested',
    skipsScreenshotReadsWhenCrashFeedbackIsRequested,
  );

  async function skipsCrashReadsWhenScreenshotFeedbackIsRequested() {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      screenshotSubmissions: [{ id: 's1', screenshots: [{ url: 'https://a/1.png' }] }],
    });

    const feedbackEntries = await listBetaFeedback(appleStore, 'com.x', { kind: 'screenshot' });

    expect(
      feedbackEntries.map(function feedbackId(feedbackEntry) {
        return feedbackEntry.id;
      }),
    ).toEqual(['s1']);
    expect(appleStore.listBetaFeedbackCrashSubmissions).not.toHaveBeenCalled();
  }

  it(
    'skips crash reads when screenshot feedback is requested',
    skipsCrashReadsWhenScreenshotFeedbackIsRequested,
  );

  async function resolvesABuildVersionIntoTheServerSideBuildFilter() {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      builds: {
        42: { id: 'build-42', version: '42', processingState: 'VALID', expired: false },
      },
      crashSubmissions: [{ id: 'c1' }],
    });

    await listBetaFeedback(appleStore, 'com.x', { build: '42' });

    expect(appleStore.findBuildByVersion).toHaveBeenCalledWith('app1', 42);
    expect(appleStore.listBetaFeedbackCrashSubmissions).toHaveBeenCalledWith('app1', {
      buildId: 'build-42',
    });
  }

  it(
    'resolves a build version into the server-side build filter',
    resolvesABuildVersionIntoTheServerSideBuildFilter,
  );

  async function rejectsMissingAndNonNumericBuilds() {
    const appleStore = makeAppleStore({ appIds: { 'com.x': 'app1' }, builds: {} });

    const betaFeedback = listBetaFeedback(appleStore, 'com.x', { build: '99' });

    await expect(betaFeedback).rejects.toMatchObject({
      message: expect.stringContaining('No build 99'),
    });
    await expect(listBetaFeedback(appleStore, 'com.x', { build: '1.2.0' })).rejects.toMatchObject({
      message: expect.stringContaining('CFBundleVersion'),
    });
    expect(appleStore.findBuildByVersion).toHaveBeenCalledTimes(1);
  }

  it('rejects missing and non-numeric builds', rejectsMissingAndNonNumericBuilds);

  async function omitsAnEmptyScreenshotCollection() {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      screenshotSubmissions: [{ id: 's1', screenshots: [] }],
    });

    const [feedbackEntry] = await listBetaFeedback(appleStore, 'com.x', { kind: 'screenshot' });

    expect(feedbackEntry).toBeDefined();

    const isFeedbackMissing = feedbackEntry == null;

    if (isFeedbackMissing) {
      expect(feedbackEntry).toBeUndefined();
      return;
    }

    expect('screenshots' in feedbackEntry).toBe(false);
  }

  it('omits an empty screenshot collection', omitsAnEmptyScreenshotCollection);
}

describe('listBetaFeedback', describeListBetaFeedback);

function describeDownloadFeedbackAttachments() {
  async function writesOneFilePerScreenshotAndSkipsCrashFeedback() {
    const bufferBytes = Buffer.from('imgbytes');
    const appleStore = makeAppleStore({ screenshotBytes: bufferBytes });
    const feedbackEntries: BetaFeedback[] = [
      { id: 'c1', kind: 'crash' },
      {
        id: 's1',
        kind: 'screenshot',
        screenshots: [{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }],
      },
    ];
    const systemTemporaryDirectory = tmpdir();
    const launchFeedbackPath = join(systemTemporaryDirectory, 'launch-feedback-');
    const outputDirectory = mkdtempSync(launchFeedbackPath);

    const downloadedAttachments = await downloadFeedbackAttachments(
      appleStore,
      feedbackEntries,
      outputDirectory,
    );

    const s11Path = join(outputDirectory, 's1-1.png');
    const s12Path = join(outputDirectory, 's1-2.png');

    expect(
      downloadedAttachments.map(function attachmentPath(attachment) {
        return attachment.path;
      }),
    ).toEqual([s11Path, s12Path]);
    expect(readdirSync(outputDirectory).sort()).toEqual(['s1-1.png', 's1-2.png']);

    const joinedPath = join(outputDirectory, 's1-1.png');

    expect(readFileSync(joinedPath).toString()).toBe('imgbytes');
    expect(appleStore.downloadBetaFeedbackScreenshot).toHaveBeenCalledTimes(2);
  }

  it(
    'writes one file per screenshot and skips crash feedback',
    writesOneFilePerScreenshotAndSkipsCrashFeedback,
  );

  async function encodesUnsafeFeedbackIdsIntoDistinctChildPaths() {
    const bufferBytes = Buffer.from('x');
    const appleStore = makeAppleStore({ screenshotBytes: bufferBytes });
    const feedbackEntries: BetaFeedback[] = [
      { id: '../a', kind: 'screenshot', screenshots: [{ url: 'https://a/1.png' }] },
      { id: 'a/..', kind: 'screenshot', screenshots: [{ url: 'https://a/2.png' }] },
    ];
    const systemTemporaryDirectory = tmpdir();
    const launchFeedbackPath = join(systemTemporaryDirectory, 'launch-feedback-');
    const outputDirectory = mkdtempSync(launchFeedbackPath);

    const downloadedAttachments = await downloadFeedbackAttachments(
      appleStore,
      feedbackEntries,
      outputDirectory,
    );
    const filenames = readdirSync(outputDirectory).sort();

    expect(filenames).toHaveLength(2);

    for (const filename of filenames) {
      expect(filename).toMatch(/^[A-Za-z0-9_-]+-1\.png$/);
    }

    for (const attachment of downloadedAttachments) {
      expect(attachment.path.startsWith(`${outputDirectory}/`)).toBe(true);
    }
  }

  it(
    'encodes unsafe feedback ids into distinct child paths',
    encodesUnsafeFeedbackIdsIntoDistinctChildPaths,
  );
}

describe('downloadFeedbackAttachments', describeDownloadFeedbackAttachments);
