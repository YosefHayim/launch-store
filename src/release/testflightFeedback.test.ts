import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../types/appleCatalog.js';
import type { BetaFeedback } from '../types/app.js';
import {
  type AscFeedbackApi,
  downloadFeedbackAttachments,
  listBetaFeedback,
} from './testflightFeedback.js';

type AppleStoreOptions = Readonly<{
  appIds?: Record<string, string>;
  crashSubmissions?: BetaFeedbackCrashSubmissionResource[];
  screenshotSubmissions?: BetaFeedbackScreenshotSubmissionResource[];
  builds?: Record<number, BuildResource>;
  screenshotBytes?: Buffer;
}>;

/** Create an Effect-native App Store feedback fake. */
const makeAppleStore = (options: AppleStoreOptions): AscFeedbackApi => ({
  getAppId: vi.fn((bundleId: string) => {
    const appId = options.appIds?.[bundleId];
    if (appId === undefined) return Effect.succeed(null);
    return Effect.succeed(appId);
  }),
  findBuildByVersion: vi.fn((_appId: string, buildNumber: number) => {
    const matchedBuild = options.builds?.[buildNumber];
    if (matchedBuild === undefined) return Effect.succeed(null);
    return Effect.succeed(matchedBuild);
  }),
  listBetaFeedbackCrashSubmissions: vi.fn(() => {
    if (options.crashSubmissions === undefined) return Effect.succeed([]);
    return Effect.succeed(options.crashSubmissions);
  }),
  listBetaFeedbackScreenshotSubmissions: vi.fn(() => {
    if (options.screenshotSubmissions === undefined) return Effect.succeed([]);
    return Effect.succeed(options.screenshotSubmissions);
  }),
  downloadBetaFeedbackScreenshot: vi.fn(() => {
    if (options.screenshotBytes === undefined) return Effect.succeed(Buffer.from('png'));
    return Effect.succeed(options.screenshotBytes);
  }),
});

describe('listBetaFeedback', () => {
  it('fails clearly when the app record is missing', async () => {
    const appleStore = makeAppleStore({ appIds: {} });
    await expect(Effect.runPromise(listBetaFeedback(appleStore, 'com.x.missing'))).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('merges crash and screenshot feedback newest-first', async () => {
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
    const feedbackEntries = await Effect.runPromise(listBetaFeedback(appleStore, 'com.x'));
    expect(feedbackEntries.map((feedbackEntry) => feedbackEntry.id)).toEqual(['s1', 'c1']);
    expect(feedbackEntries.find((feedbackEntry) => feedbackEntry.id === 'c1')?.kind).toBe('crash');
    const screenshotFeedback = feedbackEntries.find((feedbackEntry) => feedbackEntry.id === 's1');
    expect(screenshotFeedback?.kind).toBe('screenshot');
    expect(screenshotFeedback?.screenshots).toEqual([{ url: 'https://a/1.png' }]);
  });

  it('skips screenshot reads when crash feedback is requested', async () => {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      crashSubmissions: [{ id: 'c1' }],
    });
    const feedbackEntries = await Effect.runPromise(
      listBetaFeedback(appleStore, 'com.x', { kind: 'crash' }),
    );
    expect(feedbackEntries.map((feedbackEntry) => feedbackEntry.id)).toEqual(['c1']);
    expect(appleStore.listBetaFeedbackScreenshotSubmissions).not.toHaveBeenCalled();
  });

  it('skips crash reads when screenshot feedback is requested', async () => {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      screenshotSubmissions: [{ id: 's1', screenshots: [{ url: 'https://a/1.png' }] }],
    });
    const feedbackEntries = await Effect.runPromise(
      listBetaFeedback(appleStore, 'com.x', { kind: 'screenshot' }),
    );
    expect(feedbackEntries.map((feedbackEntry) => feedbackEntry.id)).toEqual(['s1']);
    expect(appleStore.listBetaFeedbackCrashSubmissions).not.toHaveBeenCalled();
  });

  it('resolves a build version into the server-side build filter', async () => {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      builds: {
        42: { id: 'build-42', version: '42', processingState: 'VALID', expired: false },
      },
      crashSubmissions: [{ id: 'c1' }],
    });
    await Effect.runPromise(listBetaFeedback(appleStore, 'com.x', { build: '42' }));
    expect(appleStore.findBuildByVersion).toHaveBeenCalledWith('app1', 42);
    expect(appleStore.listBetaFeedbackCrashSubmissions).toHaveBeenCalledWith('app1', {
      buildId: 'build-42',
    });
  });

  it('rejects missing and non-numeric builds', async () => {
    const appleStore = makeAppleStore({ appIds: { 'com.x': 'app1' }, builds: {} });
    await expect(
      Effect.runPromise(listBetaFeedback(appleStore, 'com.x', { build: '99' })),
    ).rejects.toThrow(/No build 99/);
    await expect(
      Effect.runPromise(listBetaFeedback(appleStore, 'com.x', { build: '1.2.0' })),
    ).rejects.toThrow(/CFBundleVersion/);
    expect(appleStore.findBuildByVersion).toHaveBeenCalledTimes(1);
  });

  it('omits an empty screenshot collection', async () => {
    const appleStore = makeAppleStore({
      appIds: { 'com.x': 'app1' },
      screenshotSubmissions: [{ id: 's1', screenshots: [] }],
    });
    const [feedbackEntry] = await Effect.runPromise(
      listBetaFeedback(appleStore, 'com.x', { kind: 'screenshot' }),
    );
    expect(feedbackEntry).toBeDefined();
    expect(feedbackEntry !== undefined && 'screenshots' in feedbackEntry).toBe(false);
  });
});

describe('downloadFeedbackAttachments', () => {
  it('writes one file per screenshot and skips crash feedback', async () => {
    const appleStore = makeAppleStore({ screenshotBytes: Buffer.from('imgbytes') });
    const feedbackEntries: BetaFeedback[] = [
      { id: 'c1', kind: 'crash' },
      {
        id: 's1',
        kind: 'screenshot',
        screenshots: [{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }],
      },
    ];
    const outputDirectory = mkdtempSync(join(tmpdir(), 'launch-feedback-'));
    const downloadedAttachments = await Effect.runPromise(
      downloadFeedbackAttachments(appleStore, feedbackEntries, outputDirectory).pipe(
        Effect.provide(NodeContext.layer),
      ),
    );
    expect(downloadedAttachments.map((attachment) => attachment.path)).toEqual([
      join(outputDirectory, 's1-1.png'),
      join(outputDirectory, 's1-2.png'),
    ]);
    expect(readdirSync(outputDirectory).sort()).toEqual(['s1-1.png', 's1-2.png']);
    expect(readFileSync(join(outputDirectory, 's1-1.png')).toString()).toBe('imgbytes');
    expect(appleStore.downloadBetaFeedbackScreenshot).toHaveBeenCalledTimes(2);
  });

  it('encodes unsafe feedback ids into distinct child paths', async () => {
    const appleStore = makeAppleStore({ screenshotBytes: Buffer.from('x') });
    const feedbackEntries: BetaFeedback[] = [
      { id: '../a', kind: 'screenshot', screenshots: [{ url: 'https://a/1.png' }] },
      { id: 'a/..', kind: 'screenshot', screenshots: [{ url: 'https://a/2.png' }] },
    ];
    const outputDirectory = mkdtempSync(join(tmpdir(), 'launch-feedback-'));
    const downloadedAttachments = await Effect.runPromise(
      downloadFeedbackAttachments(appleStore, feedbackEntries, outputDirectory).pipe(
        Effect.provide(NodeContext.layer),
      ),
    );
    const filenames = readdirSync(outputDirectory).sort();
    expect(filenames).toHaveLength(2);
    for (const filename of filenames) expect(filename).toMatch(/^[A-Za-z0-9_-]+-1\.png$/);
    for (const attachment of downloadedAttachments) {
      expect(attachment.path.startsWith(`${outputDirectory}/`)).toBe(true);
    }
  });
});
