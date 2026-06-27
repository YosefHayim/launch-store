import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackScreenshotSubmissionResource,
  BuildResource,
} from '../apple/ascClient.js';
import {
  downloadFeedbackAttachments,
  listBetaFeedback,
  type AscFeedbackApi,
} from './testflightFeedback.js';
import type { BetaFeedback } from './types.js';

/**
 * A hand-rolled {@link AscFeedbackApi}. `appId` maps bundle ids to app records (absent → no record);
 * `crashes` / `screenshots` are what each list call returns; `builds` resolves a version → resource id.
 */
function makeApi(opts: {
  appId?: Record<string, string>;
  crashes?: BetaFeedbackCrashSubmissionResource[];
  screenshots?: BetaFeedbackScreenshotSubmissionResource[];
  builds?: Record<number, BuildResource>;
  bytes?: Buffer;
}): AscFeedbackApi {
  return {
    getAppId: vi.fn((bundleId: string) => Promise.resolve(opts.appId?.[bundleId] ?? null)),
    findBuildByVersion: vi.fn((_appId: string, version: number) =>
      Promise.resolve(opts.builds?.[version] ?? null),
    ),
    listBetaFeedbackCrashSubmissions: vi.fn(() => Promise.resolve(opts.crashes ?? [])),
    listBetaFeedbackScreenshotSubmissions: vi.fn(() => Promise.resolve(opts.screenshots ?? [])),
    downloadBetaFeedbackScreenshot: vi.fn(() => Promise.resolve(opts.bytes ?? Buffer.from('png'))),
  };
}

describe('listBetaFeedback', () => {
  it('throws an actionable error when the app record is missing', async () => {
    const api = makeApi({ appId: {} });
    await expect(listBetaFeedback(api, 'com.x.missing')).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });

  it('merges crash + screenshot feedback newest-first and tags each kind', async () => {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      crashes: [{ id: 'c1', createdDate: '2026-06-18T00:00:00Z', comment: 'crash' }],
      screenshots: [
        {
          id: 's1',
          createdDate: '2026-06-20T00:00:00Z',
          screenshots: [{ url: 'https://a/1.png' }],
        },
      ],
    });
    const result = await listBetaFeedback(api, 'com.x');
    expect(result.map((item) => item.id)).toEqual(['s1', 'c1']);
    expect(result.find((item) => item.id === 'c1')?.kind).toBe('crash');
    const shot = result.find((item) => item.id === 's1');
    expect(shot?.kind).toBe('screenshot');
    expect(shot?.screenshots).toEqual([{ url: 'https://a/1.png' }]);
  });

  it('--type crash skips the screenshot call entirely', async () => {
    const api = makeApi({ appId: { 'com.x': 'app1' }, crashes: [{ id: 'c1' }] });
    const result = await listBetaFeedback(api, 'com.x', { kind: 'crash' });
    expect(result.map((item) => item.id)).toEqual(['c1']);
    expect(api.listBetaFeedbackScreenshotSubmissions).not.toHaveBeenCalled();
  });

  it('--type screenshot skips the crash call entirely', async () => {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      screenshots: [{ id: 's1', screenshots: [{ url: 'https://a/1.png' }] }],
    });
    const result = await listBetaFeedback(api, 'com.x', { kind: 'screenshot' });
    expect(result.map((item) => item.id)).toEqual(['s1']);
    expect(api.listBetaFeedbackCrashSubmissions).not.toHaveBeenCalled();
  });

  it('--build resolves the version to a build id and pushes it as a server filter', async () => {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      builds: { 42: { id: 'build-42', version: '42', processingState: 'VALID', expired: false } },
      crashes: [{ id: 'c1' }],
    });
    await listBetaFeedback(api, 'com.x', { build: '42' });
    expect(api.findBuildByVersion).toHaveBeenCalledWith('app1', 42);
    expect(api.listBetaFeedbackCrashSubmissions).toHaveBeenCalledWith('app1', {
      buildId: 'build-42',
    });
  });

  it('--build errors when no such build exists on the app', async () => {
    const api = makeApi({ appId: { 'com.x': 'app1' }, builds: {} });
    await expect(listBetaFeedback(api, 'com.x', { build: '99' })).rejects.toThrow(/No build 99/);
  });

  it('--build rejects a non-numeric CFBundleVersion before any network call', async () => {
    const api = makeApi({ appId: { 'com.x': 'app1' } });
    await expect(listBetaFeedback(api, 'com.x', { build: '1.2.0' })).rejects.toThrow(
      /CFBundleVersion/,
    );
    expect(api.findBuildByVersion).not.toHaveBeenCalled();
  });

  it('omits an empty screenshots array on a screenshot submission with no usable images', async () => {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      screenshots: [{ id: 's1', screenshots: [] }],
    });
    const [item] = await listBetaFeedback(api, 'com.x', { kind: 'screenshot' });
    expect(item).toBeDefined();
    expect(item && 'screenshots' in item).toBe(false);
  });
});

describe('downloadFeedbackAttachments', () => {
  it('writes one file per screenshot, named <id>-<n>.png, and skips crashes', async () => {
    const api = makeApi({ bytes: Buffer.from('imgbytes') });
    const feedback: BetaFeedback[] = [
      { id: 'c1', kind: 'crash' },
      {
        id: 's1',
        kind: 'screenshot',
        screenshots: [{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }],
      },
    ];
    const outDir = mkdtempSync(join(tmpdir(), 'launch-feedback-'));
    const written = await downloadFeedbackAttachments(api, feedback, outDir);

    expect(written.map((entry) => entry.path)).toEqual([
      join(outDir, 's1-1.png'),
      join(outDir, 's1-2.png'),
    ]);
    expect(readdirSync(outDir).sort()).toEqual(['s1-1.png', 's1-2.png']);
    expect(readFileSync(join(outDir, 's1-1.png')).toString()).toBe('imgbytes');
    expect(api.downloadBetaFeedbackScreenshot).toHaveBeenCalledTimes(2);
  });

  it('encodes a non-path-safe feedback id so downloads stay in outDir without colliding', async () => {
    const api = makeApi({ bytes: Buffer.from('x') });
    // Both ids collapse to "a" under a naive character strip — encoding must keep them distinct.
    const feedback: BetaFeedback[] = [
      { id: '../a', kind: 'screenshot', screenshots: [{ url: 'https://a/1.png' }] },
      { id: 'a/..', kind: 'screenshot', screenshots: [{ url: 'https://a/2.png' }] },
    ];
    const outDir = mkdtempSync(join(tmpdir(), 'launch-feedback-'));
    const written = await downloadFeedbackAttachments(api, feedback, outDir);

    const files = readdirSync(outDir).sort();
    expect(files).toHaveLength(2); // distinct encodings → no overwrite
    for (const name of files) expect(name).toMatch(/^[A-Za-z0-9_-]+-1\.png$/); // path-safe child of outDir
    for (const entry of written) expect(entry.path.startsWith(`${outDir}/`)).toBe(true);
  });
});
