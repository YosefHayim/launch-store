import { FileSystem } from '@effect/platform';
import { NodeContext, NodeStream } from '@effect/platform-node';
import { Effect } from 'effect';
import type { AndroidReleaseNote, PlayTrack, SubmitTarget } from '@core/types/app.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import type { PlayRelease } from '@core/types/googlePlay.js';
import {
  makeProviderInputFailure,
  type SubmitArtifact,
  type Submitter,
} from '@core/types/providers.js';
import {
  GoogleStoreClientLive,
  GoogleStoreClientService,
} from '@core/services/googleStoreClient.js';

/**
 * The release a Play upload lands as: a partial rollout is a staged (`inProgress`) release at that
 * fraction, a full one is `completed`, and configured notes ride along per locale.
 */
const playReleaseFor = (
  rollout: number,
  releaseNotes: readonly AndroidReleaseNote[] | undefined,
): Omit<PlayRelease, 'versionCodes'> => {
  let release: Omit<PlayRelease, 'versionCodes'> = { status: 'completed' };
  if (rollout < 1) release = { status: 'inProgress', userFraction: rollout };
  if (releaseNotes === undefined) return release;
  if (releaseNotes.length === 0) return release;
  return { ...release, releaseNotes: releaseNotes.map((releaseNote) => ({ ...releaseNote })) };
};

export const googlePlaySubmitter: Submitter = {
  name: 'google-play',
  submit(
    artifact: SubmitArtifact,
    target: SubmitTarget,
    buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ) {
    if (buildCredentials.platform !== 'android') {
      return Effect.fail(
        makeProviderInputFailure({
          provider: 'google-play',
          message: 'The google-play submitter handles Android only.',
        }),
      );
    }
    const packageName = buildContext.app.packageName;
    if (packageName === undefined) {
      return Effect.fail(
        makeProviderInputFailure({
          provider: 'google-play',
          message: `No Android application id for ${buildContext.app.name}. Set android.package in app.json.`,
        }),
      );
    }
    // Resolved upstream from Android build settings; use the safe default for the neutral target.
    let track: PlayTrack = 'internal';
    if (target === 'production') track = 'production';
    if (buildContext.android?.track !== undefined) track = buildContext.android.track;
    let rollout = 1.0;
    if (buildContext.android?.rollout !== undefined) rollout = buildContext.android.rollout;
    const release = playReleaseFor(rollout, buildContext.android?.releaseNotes);
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const bundleFile = fileSystem.stream(artifact.path);
      const bundleStream = yield* NodeStream.toReadable(bundleFile);
      const googleStoreClients = yield* GoogleStoreClientService;
      const playClient = yield* googleStoreClients.createEffectClient(
        buildCredentials.serviceAccountJson,
      );
      yield* playClient.uploadBundleToTrack(packageName, bundleStream, track, release);
    }).pipe(Effect.provide(GoogleStoreClientLive), Effect.provide(NodeContext.layer));
  },
};
