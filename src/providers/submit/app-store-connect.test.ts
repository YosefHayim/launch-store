import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildUploadStatus } from '@/types/apple-catalog.js';
import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';

const ascFake = vi.hoisted(function hoistAscFake() {
  return {
    getAppId: vi.fn<(bundleId: string) => Promise<string | null>>(),
    createBuildUpload:
      vi.fn<
        (buildUpload: {
          appId: string;
          version: string;
          buildNumber: number;
          platform: string;
        }) => Promise<string>
      >(),
    uploadBuildFile:
      vi.fn<(buildUploadId: string, fileName: string, binaryPath: string) => Promise<void>>(),
    getBuildUploadStatus: vi.fn<(buildUploadId: string) => Promise<BuildUploadStatus>>(),
  };
});

vi.mock('@/apple/app-store-connect.js', function mockAppStoreConnect() {
  return {
    AppStoreConnect: class {
      getAppId = ascFake.getAppId;
      createBuildUpload = ascFake.createBuildUpload;
      uploadBuildFile = ascFake.uploadBuildFile;
      getBuildUploadStatus = ascFake.getBuildUploadStatus;
    },
  };
});

const { makeAppStoreConnectSubmitter } = await import('./app-store-connect.ts');
const submitter = makeAppStoreConnectSubmitter(1, 30 * 60 * 1000);
const ipaPath = fileURLToPath(import.meta.url);
const artifact = { path: ipaPath, version: '1.4.0', buildNumber: 42 };

function iosContext(platform: ResolvedBuildContext['platform'] = 'ios'): ResolvedBuildContext {
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
}

const IOS_CREDENTIALS: BuildCredentials = {
  platform: 'ios',
  ascKey: { keyId: 'K', issuerId: 'I', p8: 'PEM' },
};

function uploadStatus(state: string, errors: BuildUploadStatus['errors'] = []): BuildUploadStatus {
  return { state, fileState: '', errors };
}

function acceptUploads(): void {
  ascFake.getAppId.mockResolvedValue('app-1');
  ascFake.createBuildUpload.mockResolvedValue('upload-1');
  ascFake.uploadBuildFile.mockResolvedValue(undefined);
}

function cleanup() {
  return vi.resetAllMocks();
}

afterEach(cleanup);

function describeAppStoreConnectSubmitterBuildUploadAPI() {
  async function uploadsTheBinaryForItsVersionAndBuildThenWaitsUntilAppleAcceptsIt() {
    acceptUploads();
    ascFake.getBuildUploadStatus
      .mockResolvedValueOnce(uploadStatus('AWAITING_UPLOAD'))
      .mockResolvedValueOnce(uploadStatus('PROCESSING'))
      .mockResolvedValueOnce(uploadStatus('COMPLETE'));

    const ios = iosContext();

    await submitter.submit(artifact, IOS_CREDENTIALS, ios);
    expect(ascFake.getAppId).toHaveBeenCalledWith('com.example.hello');
    expect(ascFake.createBuildUpload).toHaveBeenCalledWith({
      appId: 'app-1',
      version: '1.4.0',
      buildNumber: 42,
      platform: 'IOS',
    });
    expect(ascFake.uploadBuildFile).toHaveBeenCalledWith(
      'upload-1',
      'app-store-connect.test.ts',
      ipaPath,
    );
    expect(ascFake.getBuildUploadStatus).toHaveBeenCalledTimes(3);
  }

  it(
    'uploads the binary for its version and build, then waits until Apple accepts it',
    uploadsTheBinaryForItsVersionAndBuildThenWaitsUntilAppleAcceptsIt,
  );

  async function uploadsATvOSBuildForTheTVOSPlatform() {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(uploadStatus('COMPLETE'));

    const ios = iosContext('tvos');

    await submitter.submit(artifact, IOS_CREDENTIALS, ios);
    expect(ascFake.createBuildUpload).toHaveBeenCalledWith({
      appId: 'app-1',
      version: '1.4.0',
      buildNumber: 42,
      platform: 'TV_OS',
    });
  }

  it('uploads a tvOS build for the TV_OS platform', uploadsATvOSBuildForTheTVOSPlatform);

  async function tellsTheUserToBumpTheVersionWhenTheVersionTrainIsClosed() {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(
      uploadStatus('FAILED', [{ code: '90186', description: 'Invalid Pre-Release Train.' }]),
    );

    const ios = iosContext();

    await expect(submitter.submit(artifact, IOS_CREDENTIALS, ios)).rejects.toThrow(
      /no longer takes builds for version 1\.4\.0\. Bump the app version/,
    );
  }

  it(
    'tells the user to bump the version when the version train is closed',
    tellsTheUserToBumpTheVersionWhenTheVersionTrainIsClosed,
  );

  async function stillNamesTheClosedVersionTrainWhenAppleGivesOtherReasonsToo() {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue(
      uploadStatus('FAILED', [
        { code: '90186', description: 'Invalid Pre-Release Train.' },
        { code: '90087', description: 'Unsupported Architectures.' },
      ]),
    );

    const ios = iosContext();

    await expect(submitter.submit(artifact, IOS_CREDENTIALS, ios)).rejects.toThrow(
      /Bump the app version[\s\S]*Unsupported Architectures\. \(90087\)/,
    );
  }

  it(
    'still names the closed version train when Apple gives other reasons too',
    stillNamesTheClosedVersionTrainWhenAppleGivesOtherReasonsToo,
  );

  async function countsSlowStatusRepliesTowardTheWaitSoItGivesUpOnTime() {
    acceptUploads();

    async function mockImplementationPiece() {
      await new Promise(function statusReplied(done) {
        setTimeout(done, 30);
      });
      return uploadStatus('PROCESSING');
    }

    ascFake.getBuildUploadStatus.mockImplementation(mockImplementationPiece);

    const shortWait = makeAppStoreConnectSubmitter(1, 100);
    const ios = iosContext();

    await expect(shortWait.submit(artifact, IOS_CREDENTIALS, ios)).rejects.toThrow(
      /still processing build upload upload-1/,
    );
    expect(ascFake.getBuildUploadStatus.mock.calls.length).toBeLessThan(10);
  }

  it(
    'counts slow status replies toward the wait, so it gives up on time',
    countsSlowStatusRepliesTowardTheWaitSoItGivesUpOnTime,
  );

  async function listsEveryReasonAppleGivesForARejectedUpload() {
    acceptUploads();
    ascFake.getBuildUploadStatus.mockResolvedValue({
      state: 'PROCESSING',
      fileState: 'FAILED',
      errors: [{ code: '90087', description: 'Unsupported Architectures.' }],
    });

    const ios = iosContext();

    await expect(submitter.submit(artifact, IOS_CREDENTIALS, ios)).rejects.toMatchObject({
      _tag: 'StoreUploadFailure',
      provider: 'app-store-connect',
      message: 'App Store Connect rejected the build upload:\n- Unsupported Architectures. (90087)',
    });
  }

  it(
    'lists every reason Apple gives for a rejected upload',
    listsEveryReasonAppleGivesForARejectedUpload,
  );

  async function failsBeforeUploadingWhenTheAppPieceDoesNotExist() {
    ascFake.getAppId.mockResolvedValue(null);

    const ios = iosContext();

    await expect(submitter.submit(artifact, IOS_CREDENTIALS, ios)).rejects.toThrow(
      /com\.example\.hello/,
    );
    expect(ascFake.createBuildUpload).not.toHaveBeenCalled();
  }

  it(
    'fails before uploading when the app record does not exist',
    failsBeforeUploadingWhenTheAppPieceDoesNotExist,
  );

  async function rejectsANonAppleCredential() {
    const androidCredentials: BuildCredentials = { platform: 'android', serviceAccountJson: '{}' };
    const ios = iosContext();

    await expect(submitter.submit(artifact, androidCredentials, ios)).rejects.toThrow(
      /Apple platforms only/,
    );
  }

  it('rejects a non-Apple credential', rejectsANonAppleCredential);
}

describe(
  'app-store-connect submitter - build upload API',
  describeAppStoreConnectSubmitterBuildUploadAPI,
);
