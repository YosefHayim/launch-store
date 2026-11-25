import { readFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import type { PlayRelease } from '@core/types/googlePlay.js';
// Stand in for the Android Publisher API so the submitter's upload runs without the network.
const uploadBundleToTrack = vi.hoisted(() =>
  vi.fn<
    (
      packageName: string,
      bundleBytes: Buffer,
      track: string,
      release: Omit<PlayRelease, 'versionCodes'>,
    ) => void
  >(),
);
const playUpload = vi.hoisted(() => {
  const bundleStreams: Readable[] = [];
  return { isRejected: false, bundleStreams };
});
vi.mock('@google/playClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/playClient.js')>()),
  parseServiceAccount: () => Effect.succeed({}),
  GooglePlayClient: class {
    uploadBundleToTrack = (
      packageName: string,
      bundleStream: Readable,
      track: string,
      release: Omit<PlayRelease, 'versionCodes'>,
    ) => {
      playUpload.bundleStreams.push(bundleStream);
      if (playUpload.isRejected) return Effect.fail(new Error('Google Play rejected the edit.'));
      return Effect.promise(async () => {
        const bundleBytes = await buffer(bundleStream);
        uploadBundleToTrack(packageName, bundleBytes, track, release);
        return 7;
      });
    };
  },
}));
const { googlePlaySubmitter } = await import('./googlePlay.js');
const aabPath = fileURLToPath(import.meta.url);
const artifact = { path: aabPath, version: '1.4.0', buildNumber: 7 };
const creds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
/** Minimal Android build context whose app has DIFFERENT android.package vs ios.bundleIdentifier. */
const androidCtx = (
  android: ResolvedBuildContext['android'] = { track: 'internal', rollout: 1 },
): ResolvedBuildContext => {
  return {
    platform: 'android',
    app: {
      name: 'hello',
      dir: '/apps/hello',
      configPath: '/apps/hello/app.json',
      packageName: 'com.example.hello.android',
      bundleId: 'com.example.hello.ios',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: false,
    forceClean: false,
    android,
  };
};
const uploadCall = () => {
  const [call] = uploadBundleToTrack.mock.calls;
  if (call === undefined) return expect.unreachable('the bundle was never uploaded');
  return call;
};
afterEach(() => {
  uploadBundleToTrack.mockClear();
  playUpload.isRejected = false;
  playUpload.bundleStreams.length = 0;
});
describe('google-play submitter - package_name (EAS #3563 regression)', () => {
  it('uploads to android.package, NOT the iOS bundle identifier', async () => {
    await Effect.runPromise(googlePlaySubmitter.submit(artifact, creds, androidCtx()));
    const [packageName, bundleBytes, track, release] = uploadCall();
    expect(packageName).toBe('com.example.hello.android');
    expect(bundleBytes.equals(readFileSync(aabPath))).toBe(true);
    expect(track).toBe('internal');
    expect(release).toEqual({ status: 'completed' });
  });
  it('stages a partial rollout as an in-progress release at that fraction', async () => {
    await Effect.runPromise(
      googlePlaySubmitter.submit(
        artifact,
        creds,
        androidCtx({ track: 'production', rollout: 0.1 }),
      ),
    );
    const [, , track, release] = uploadCall();
    expect(track).toBe('production');
    expect(release).toEqual({ status: 'inProgress', userFraction: 0.1 });
  });
  it('closes the bundle file when Google Play fails before reading it', async () => {
    playUpload.isRejected = true;
    await expect(
      Effect.runPromise(googlePlaySubmitter.submit(artifact, creds, androidCtx())),
    ).rejects.toThrow(/rejected the edit/);
    const [bundleStream] = playUpload.bundleStreams;
    expect(bundleStream?.destroyed).toBe(true);
  });
  it('rejects a non-Android credential', async () => {
    const iosCreds: BuildCredentials = {
      platform: 'ios',
      ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
    };
    await expect(
      Effect.runPromise(googlePlaySubmitter.submit(artifact, iosCreds, androidCtx())),
    ).rejects.toThrow(/Android only/);
    expect(uploadBundleToTrack).not.toHaveBeenCalled();
  });
});
describe('google-play submitter - release notes (issue #309)', () => {
  it('sends the configured release notes per locale with the release', async () => {
    await Effect.runPromise(
      googlePlaySubmitter.submit(
        artifact,
        creds,
        androidCtx({
          track: 'internal',
          rollout: 1,
          releaseNotes: [
            { language: 'en-US', text: 'Bug fixes and speed' },
            { language: 'iw-IL', text: 'תיקוני באגים' },
          ],
        }),
      ),
    );
    const [, , , release] = uploadCall();
    expect(release).toEqual({
      status: 'completed',
      releaseNotes: [
        { language: 'en-US', text: 'Bug fixes and speed' },
        { language: 'iw-IL', text: 'תיקוני באגים' },
      ],
    });
  });
});
