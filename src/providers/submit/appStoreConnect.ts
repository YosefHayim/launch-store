import { basename } from 'node:path';
import type { BuildUploadProblem } from '@/types/appleCatalog.js';
import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';
import {
  makeProviderInputFailure,
  makeStoreUploadFailure,
  type SubmitArtifact,
  type Submitter,
} from '@/types/providers.js';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
} from '@/services/stores/appleStoreClient.js';
import { toAscPlatform } from '@/services/stores/platform.js';
import type { AppStoreConnectClient } from '@/apple/ascClient.js';

const PROVIDER = 'app-store-connect';
const BUILD_UPLOAD_WAIT_MILLISECONDS = 30 * 60 * 1000;
const POLL_INTERVAL_MILLISECONDS = 5 * 1000;
const CLOSED_VERSION_TRAIN_CODES = new Set(['90062', '90186', '90478']);

function describeProblem(problem: BuildUploadProblem): string {
  return `- ${problem.description} (${problem.code})`;
}

function isClosedTrainCode(problem: BuildUploadProblem): boolean {
  return CLOSED_VERSION_TRAIN_CODES.has(problem.code);
}

function rejectionMessage(version: string, problems: readonly BuildUploadProblem[]): string {
  const problemList = problems.map(describeProblem).join('\n');
  const isClosedTrain = problems.some(isClosedTrainCode);

  if (isClosedTrain) {
    return `App Store Connect no longer takes builds for version ${version}. Bump the app version (expo.version or CFBundleShortVersionString), rebuild, and submit again.\n${problemList}`;
  }

  const hasNoProblems = problems.length == 0;

  if (hasNoProblems) {
    return 'App Store Connect rejected the build upload without a reason.';
  }

  return `App Store Connect rejected the build upload:\n${problemList}`;
}

function describeWait(waitMilliseconds: number): string {
  const waitMinutes = waitMilliseconds / 60_000;
  const isWholeMinutes = waitMinutes == Math.floor(waitMinutes);

  if (isWholeMinutes) {
    const isOneMinute = waitMinutes == 1;

    if (isOneMinute) {
      return '1 minute';
    }

    return `${waitMinutes} minutes`;
  }

  const waitSeconds = waitMilliseconds / 1000;
  const isOneSecond = waitSeconds == 1;

  if (isOneSecond) {
    return '1 second';
  }

  return `${waitSeconds} seconds`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(function wake(finish) {
    setTimeout(finish, milliseconds);
  });
}

async function waitForBuildUpload(
  appStoreClient: AppStoreConnectClient,
  buildUploadId: string,
  version: string,
  pollIntervalMilliseconds: number,
  uploadWaitMilliseconds: number,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + uploadWaitMilliseconds;
  let checkedAt = startedAt;

  while (checkedAt < deadline) {
    const uploadStatus = await appStoreClient.getBuildUploadStatus(buildUploadId);
    const isComplete = uploadStatus.state == 'COMPLETE';

    if (isComplete) {
      return;
    }

    const isRejected = [uploadStatus.state, uploadStatus.fileState].includes('FAILED');

    if (isRejected) {
      throw makeStoreUploadFailure({
        provider: PROVIDER,
        message: rejectionMessage(version, uploadStatus.errors),
      });
    }

    await sleep(pollIntervalMilliseconds);
    checkedAt = Date.now();
  }

  throw makeStoreUploadFailure({
    provider: PROVIDER,
    message: `App Store Connect is still processing build upload ${buildUploadId} after ${describeWait(uploadWaitMilliseconds)}. Check TestFlight before uploading again.`,
  });
}

async function submitAppleBuild(
  artifact: SubmitArtifact,
  buildCredentials: BuildCredentials,
  buildContext: ResolvedBuildContext,
  pollIntervalMilliseconds: number,
  uploadWaitMilliseconds: number,
): Promise<void> {
  const isAppleCredential = buildCredentials.platform == 'ios';

  if (isAppleCredential == false) {
    throw makeProviderInputFailure({
      provider: PROVIDER,
      message: 'The app-store-connect submitter handles Apple platforms only.',
    });
  }

  const bundleId = buildContext.app.bundleId;

  if (bundleId == null) {
    throw makeProviderInputFailure({
      provider: PROVIDER,
      message: `No bundle identifier for ${buildContext.app.name}. Set ios.bundleIdentifier in app.json.`,
    });
  }

  const ascPlatform = toAscPlatform(buildContext.platform);
  const appStoreClient = AppleStoreClientService.createEffectClient(buildCredentials.ascKey);
  const appId = await appStoreClient.getAppId(bundleId);

  if (appId == null) {
    throw makeProviderInputFailure({
      provider: PROVIDER,
      message: appRecordMissingMessage(bundleId, `launch build ${buildContext.platform}`),
    });
  }

  const buildUploadId = await appStoreClient.createBuildUpload(
    appId,
    artifact.version,
    artifact.buildNumber,
    ascPlatform,
  );
  await appStoreClient.uploadBuildFile(buildUploadId, basename(artifact.path), artifact.path);
  await waitForBuildUpload(
    appStoreClient,
    buildUploadId,
    artifact.version,
    pollIntervalMilliseconds,
    uploadWaitMilliseconds,
  );
}

export function makeAppStoreConnectSubmitter(
  pollIntervalMilliseconds: number,
  uploadWaitMilliseconds: number,
): Submitter {
  return {
    name: PROVIDER,
    submit(artifact, buildCredentials, buildContext) {
      return submitAppleBuild(
        artifact,
        buildCredentials,
        buildContext,
        pollIntervalMilliseconds,
        uploadWaitMilliseconds,
      );
    },
  };
}

export const appStoreConnectSubmitter = makeAppStoreConnectSubmitter(
  POLL_INTERVAL_MILLISECONDS,
  BUILD_UPLOAD_WAIT_MILLISECONDS,
);
