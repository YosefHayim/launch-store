import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Duration, Effect } from 'effect';
import type { BuildUploadStatus } from '@core/types/appleCatalog.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
// Stand in for App Store Connect so the submitter's upload flow runs without the network.
const ascFake = vi.hoisted(() => ({
  getAppId: vi.fn<(bundleId: string) => Promise<string | null>>(),
  createBuildUpload:
    vi.fn<
      (appId: string, version: string, buildNumber: number, platform: string) => Promise<string>
    >(),
  uploadBuildFile:
    vi.fn<(buildUploadId: string, fileName: string, binaryPath: string) => Promise<void>>(),
  getBuildUploadStatus: vi.fn<(buildUploadId: string) => Promise<BuildUploadStatus>>(),
}));
vi.mock('@apple/ascClient.js', () => ({
  AppStoreConnectClient: class {
    getAppId = ascFake.getAppId;
    createBuildUpload = ascFake.createBuildUpload;
    uploadBuildFile = ascFake.uploadBuildFile;
    getBuildUploadStatus = ascFake.getBuildUploadStatus;
  },
}));
const { makeAppStoreConnectSubmitter } = await import('./appStoreConnect.js');
const submitter = makeAppStoreConnectSubmitter(Duration.millis(1), Duration.minutes(30));
const ipaPath = fileURLToPath(import.meta.url);
const artifact = { path: ipaPath, version: '1.4.0', buildNumber: 42 };
/** Minimal iOS build context. */
const iosCtx = (platform: ResolvedBuildContext['platform'] = 'ios'): ResolvedBuildContext => {
  return {
    platform,
    app: {
      name: 'hello',
      dir: '/apps/hello',
      configPath: '/apps/hello/app.json',
      bundleId: 'com.example.hello',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: false,
    forceClean: false,
  };
};
const IOS_CREDS: BuildCredentials = {
  platform: 'ios',
  ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
};
const uploadStatus = (
  state: string,
  errors: BuildUploadStatus['errors'] = [],
): BuildUploadStatus => ({ state, fileState: '', errors });
const acceptUploads = (): void => {
  ascFake.getAppId.mockResolvedValue('app-1');
  ascFake.createBuildUpload.mockResolvedValue('upload-1');
  ascFake.uploadBuildFile.mockResolvedValue(undefined);
};
afterEach(() => vi.resetAllMocks());
describe('app-store-connect submitter - build upload API', () => {
  it('uploads the binary for its version and build, then waits until Apple accepts it', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus
      .mockResolvedValueOnce(uploadStatus('AWAITING_UPLOAD'))
      .mockResolvedValueOnce(uploadStatus('PROCESSING'))
      .mockResolvedValueOnce(uploadStatus('COMPLETE'));
    await Effect.runPromise(submitter.submit(artifact, IOS_CREDS, iosCtx()));
    expect(ascFake.getAppId).toHaveBeenCalledWith('com.example.hello');
    expect(ascFake.createBuildUpload).toHaveBeenCalledWith('app-1', '1.4.0', 42, 'IOS');
    expect(ascFake.uploadBuildFile).toHaveBeenCalledWith(
      'upload-1',
      'appStoreConnect.test.ts',
      ipaPath,
    );
    expect(ascFake.getBuildUploadStatus).toHaveBeenCalledTimes(3);
  });
  it('uploads a tvOS build for the TV_OS platform', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(uploadStatus('COMPLETE'));
    await Effect.runPromise(submitter.submit(artifact, IOS_CREDS, iosCtx('tvos')));
    expect(ascFake.createBuildUpload).toHaveBeenCalledWith('app-1', '1.4.0', 42, 'TV_OS');
  });
  it('tells the user to bump the version when the version train is closed', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(
      uploadStatus('FAILED', [{ code: '90186', description: 'Invalid Pre-Release Train.' }]),
    );
    await expect(
      Effect.runPromise(submitter.submit(artifact, IOS_CREDS, iosCtx())),
    ).rejects.toThrow(/no longer takes builds for version 1\.4\.0\. Bump the app version/);
  });
  it('still names the closed version train when Apple gives other reasons too', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(
      uploadStatus('FAILED', [
        { code: '90186', description: 'Invalid Pre-Release Train.' },
        { code: '90087', description: 'Unsupported Architectures.' },
      ]),
    );
    await expect(
      Effect.runPromise(submitter.submit(artifact, IOS_CREDS, iosCtx())),
    ).rejects.toThrow(/Bump the app version[\s\S]*Unsupported Architectures\. \(90087\)/);
  });
  it('counts slow status replies toward the wait, so it gives up on time', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockImplementation(async () => {
      await new Promise((statusReplied) => setTimeout(statusReplied, 30));
      return uploadStatus('PROCESSING');
    });
    const shortWait = makeAppStoreConnectSubmitter(Duration.millis(1), Duration.millis(100));
    await expect(
      Effect.runPromise(shortWait.submit(artifact, IOS_CREDS, iosCtx())),
    ).rejects.toThrow(/still processing build upload upload-1/);
    expect(ascFake.getBuildUploadStatus.mock.calls.length).toBeLessThan(10);
  });
  it('lists every reason Apple gives for a rejected upload', async () => {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue({
      state: 'PROCESSING',
      fileState: 'FAILED',
      errors: [{ code: '90087', description: 'Unsupported Architectures.' }],
    });
    const uploadFailure = submitter.submit(artifact, IOS_CREDS, iosCtx());
    await expect(Effect.runPromise(Effect.flip(uploadFailure))).resolves.toEqual({
      _tag: 'StoreUploadFailure',
      provider: 'app-store-connect',
      message: 'App Store Connect rejected the build upload:\n- Unsupported Architectures. (90087)',
    });
  });
  it('fails before uploading when the app record does not exist', async () => {
    ascFake.getAppId.mockResolvedValue(null);
    await expect(
      Effect.runPromise(submitter.submit(artifact, IOS_CREDS, iosCtx())),
    ).rejects.toThrow(/com\.example\.hello/);
    expect(ascFake.createBuildUpload).not.toHaveBeenCalled();
  });
  it('rejects a non-Apple credential', async () => {
    const androidCreds: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    await expect(
      Effect.runPromise(submitter.submit(artifact, androidCreds, iosCtx())),
    ).rejects.toThrow(/Apple platforms only/);
  });
});
