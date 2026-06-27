import { describe, expect, it } from 'vitest';
import type { BuildCredentials, ResolvedBuildContext } from '../../core/types.js';
import { gradleBuildEngine, parseBundletoolSize } from './gradle.js';

describe('parseBundletoolSize — honest worst-case download from get-size total', () => {
  it('reads MIN/MAX from a single-row total', () => {
    expect(parseBundletoolSize('MIN,MAX\n1048576,2097152')).toEqual({
      minBytes: 1048576,
      maxBytes: 2097152,
    });
  });

  it('takes the largest MAX and smallest MIN across device dimensions', () => {
    const csv = [
      'SDK,ABI,SCREEN_DENSITY,LANGUAGE,MIN,MAX',
      '21,armeabi-v7a,MDPI,en,3000000,4000000',
      '21,arm64-v8a,XXHDPI,en,3500000,6000000',
      '29,arm64-v8a,XXHDPI,en,3200000,5500000',
    ].join('\n');
    expect(parseBundletoolSize(csv)).toEqual({ minBytes: 3000000, maxBytes: 6000000 });
  });

  it('degrades to zeros on unrecognized output rather than throwing', () => {
    expect(parseBundletoolSize('totally unrelated')).toEqual({ minBytes: 0, maxBytes: 0 });
    expect(parseBundletoolSize('')).toEqual({ minBytes: 0, maxBytes: 0 });
  });
});

describe('gradleBuildEngine — dry-run rehearses without building or signing', () => {
  const ctx = {
    platform: 'android',
    app: {
      name: 'demo',
      dir: '/repo',
      configPath: '/repo/app.json',
      packageName: 'com.example.demo',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: true,
    forceClean: false,
  } satisfies ResolvedBuildContext;
  const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '' };

  it('returns a zero-byte report and never touches the keystore', async () => {
    const { artifactPath, sizeReport } = await gradleBuildEngine.build(ctx, creds);
    expect(artifactPath).toBe('(dry-run, not built)');
    expect(sizeReport).toEqual({ artifactBytes: 0, entries: [] });
  });

  it('rejects iOS credentials (wrong platform) outside dry-run', async () => {
    const realCtx = { ...ctx, dryRun: false };
    await expect(
      gradleBuildEngine.build(realCtx, {
        platform: 'ios',
        ascKey: { keyId: 'x', issuerId: 'y', p8: '' },
      }),
    ).rejects.toThrow(/Android only/);
  });
});
