import { readFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedBuildContext } from '../../types/config.ts';
import type { BuildCredentials } from '../../types/credentials.ts';
import type { PlayRelease } from '../../types/google-play.ts';

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

vi.mock('../../google/play-client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../google/play-client.ts')>()),
  readServiceAccount: () => ({
    client_email: 'robot@example.invalid',
    private_key: 'dummy',
  }),
  GooglePlayClient: class {
    async uploadBundleToTrack(
      packageName: string,
      bundleStream: Readable,
      track: string,
      release: Omit<PlayRelease, 'versionCodes'>,
    ) {
      playUpload.bundleStreams.push(bundleStream);
      const isRejected = playUpload.isRejected;

      if (isRejected) {
        throw new Error('Google Play rejected the edit.');
      }

      const bundleBytes = await buffer(bundleStream);
      uploadBundleToTrack(packageName, bundleBytes, track, release);
      return 7;
    }
  },
}));

const { googlePlaySubmitter } = await import('./google-play.ts');
const aabPath = fileURLToPath(import.meta.url);
const artifact = { path: aabPath, version: '1.4.0', buildNumber: 7 };
const credentials: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };

function androidContext(
  android: ResolvedBuildContext['android'] = { track: 'internal', rollout: 1 },
): ResolvedBuildContext {
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
}

function uploadCall() {
  const [call] = uploadBundleToTrack.mock.calls;

  if (call == null) {
    return expect.unreachable('the bundle was never uploaded');
  }

  return call;
}

afterEach(() => {
  uploadBundleToTrack.mockClear();
  playUpload.isRejected = false;
  playUpload.bundleStreams.length = 0;
});

describe('google-play submitter - package_name (EAS #3563 regression)', () => {
  it('uploads to android.package, NOT the iOS bundle identifier', async () => {
    await googlePlaySubmitter.submit(artifact, credentials, androidContext());
    const [packageName, bundleBytes, track, release] = uploadCall();
    expect(packageName).toBe('com.example.hello.android');
    expect(bundleBytes.equals(readFileSync(aabPath))).toBe(true);
    expect(track).toBe('internal');
    expect(release).toEqual({ status: 'completed' });
  });

  it('stages a partial rollout as an in-progress release at that fraction', async () => {
    await googlePlaySubmitter.submit(
      artifact,
      credentials,
      androidContext({ track: 'production', rollout: 0.1 }),
    );
    const [, , track, release] = uploadCall();
    expect(track).toBe('production');
    expect(release).toEqual({ status: 'inProgress', userFraction: 0.1 });
  });

  it('closes the bundle file when Google Play fails before reading it', async () => {
    playUpload.isRejected = true;
    await expect(
      googlePlaySubmitter.submit(artifact, credentials, androidContext()),
    ).rejects.toThrow(/rejected the edit/);
    const [bundleStream] = playUpload.bundleStreams;
    expect(bundleStream?.destroyed).toBe(true);
  });

  it('rejects a non-Android credential', async () => {
    const iosCredentials: BuildCredentials = {
      platform: 'ios',
      ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
    };
    await expect(
      googlePlaySubmitter.submit(artifact, iosCredentials, androidContext()),
    ).rejects.toThrow(/Android only/);
    expect(uploadBundleToTrack).not.toHaveBeenCalled();
  });
});

describe('google-play submitter - release notes (issue #309)', () => {
  it('sends the configured release notes per locale with the release', async () => {
    await googlePlaySubmitter.submit(
      artifact,
      credentials,
      androidContext({
        track: 'internal',
        rollout: 1,
        releaseNotes: [
          { language: 'en-US', text: 'Bug fixes and speed' },
          { language: 'iw-IL', text: 'תיקוני באגים' },
        ],
      }),
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
