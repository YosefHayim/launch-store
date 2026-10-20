import { Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Duration, Effect } from 'effect';
import type { SubmitTarget } from '@core/types/app.js';
import type { BuildUploadProblem } from '@core/types/appleCatalog.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import {
  makeProviderInputFailure,
  makeStoreUploadFailure,
  type SubmitArtifact,
  type Submitter,
} from '@core/types/providers.js';
import {
  AppleStoreClientLive,
  AppleStoreClientService,
  appRecordMissingMessage,
  type EffectAppStoreConnectClient,
} from '@core/services/appleStoreClient.js';
import { toAscPlatform } from '@core/services/platform.js';

const PROVIDER = 'app-store-connect';
/** How long Apple may take to accept a delivered binary before the submit gives up waiting. */
const BUILD_UPLOAD_WAIT = Duration.minutes(30);
/** Apple's codes for a version train that no longer takes builds (closed, or below an approved version). */
const CLOSED_VERSION_TRAIN_CODES = new Set(['90062', '90186', '90478']);

const describeProblems = (problems: readonly BuildUploadProblem[]): string =>
  problems.map((problem) => `- ${problem.description} (${problem.code})`).join('\n');

/** Turn Apple's rejection reasons into one actionable message, with a fix for the common closed-train case. */
const rejectionMessage = (version: string, problems: readonly BuildUploadProblem[]): string => {
  const problemList = describeProblems(problems);
  const isClosedTrain =
    problems.length > 0 &&
    problems.every((problem) => CLOSED_VERSION_TRAIN_CODES.has(problem.code));
  if (isClosedTrain) {
    return `App Store Connect no longer takes builds for version ${version}. Bump the app version (expo.version or CFBundleShortVersionString), rebuild, and submit again.\n${problemList}`;
  }
  if (problems.length === 0) return 'App Store Connect rejected the build upload without a reason.';
  return `App Store Connect rejected the build upload:\n${problemList}`;
};

/** Poll the build upload until Apple accepts or rejects the delivered binary. */
const waitForBuildUpload = (
  appStoreClient: EffectAppStoreConnectClient,
  buildUploadId: string,
  version: string,
  pollInterval: Duration.DurationInput,
) =>
  Effect.gen(function* () {
    const pollLimit = Math.ceil(
      Duration.toMillis(BUILD_UPLOAD_WAIT) / Duration.toMillis(pollInterval),
    );
    for (let poll = 0; poll < pollLimit; poll++) {
      const uploadStatus = yield* appStoreClient.getBuildUploadStatus(buildUploadId);
      if (uploadStatus.state === 'COMPLETE') return;
      const isRejected = [uploadStatus.state, uploadStatus.fileState].includes('FAILED');
      if (isRejected) {
        return yield* Effect.fail(
          makeStoreUploadFailure({
            provider: PROVIDER,
            message: rejectionMessage(version, uploadStatus.errors),
          }),
        );
      }
      yield* Effect.sleep(pollInterval);
    }
    return yield* Effect.fail(
      makeStoreUploadFailure({
        provider: PROVIDER,
        message: `App Store Connect is still processing build upload ${buildUploadId} after 30 minutes. Check TestFlight before uploading again.`,
      }),
    );
  });

/** The App Store Connect submitter, polling the build upload at `pollInterval` until Apple answers. */
export const makeAppStoreConnectSubmitter = (pollInterval: Duration.DurationInput): Submitter => ({
  name: PROVIDER,
  submit(
    artifact: SubmitArtifact,
    _target: SubmitTarget,
    buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ) {
    if (buildCredentials.platform !== 'ios') {
      return Effect.fail(
        makeProviderInputFailure({
          provider: PROVIDER,
          message: 'The app-store-connect submitter handles Apple platforms only.',
        }),
      );
    }
    const bundleId = buildContext.app.bundleId;
    if (bundleId === undefined) {
      return Effect.fail(
        makeProviderInputFailure({
          provider: PROVIDER,
          message: `No bundle identifier for ${buildContext.app.name}. Set ios.bundleIdentifier in app.json.`,
        }),
      );
    }
    return Effect.gen(function* () {
      const ascPlatform = yield* toAscPlatform(buildContext.platform);
      const appleStoreClients = yield* AppleStoreClientService;
      const appStoreClient = yield* appleStoreClients.createEffectClient(buildCredentials.ascKey);
      const appId = yield* appStoreClient.getAppId(bundleId);
      if (appId === null) {
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: PROVIDER,
            message: appRecordMissingMessage(bundleId, `launch build ${buildContext.platform}`),
          }),
        );
      }
      const buildUploadId = yield* appStoreClient.createBuildUpload(
        appId,
        artifact.version,
        artifact.buildNumber,
        ascPlatform,
      );
      const pathService = yield* Path.Path;
      yield* appStoreClient.uploadBuildFile(
        buildUploadId,
        pathService.basename(artifact.path),
        artifact.path,
      );
      yield* waitForBuildUpload(appStoreClient, buildUploadId, artifact.version, pollInterval);
    }).pipe(Effect.provide(AppleStoreClientLive), Effect.provide(NodeContext.layer));
  },
});

export const appStoreConnectSubmitter = makeAppStoreConnectSubmitter(Duration.seconds(5));
