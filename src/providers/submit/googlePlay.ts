import { createReadStream } from 'node:fs';
import type { AndroidReleaseNote, PlayTrack } from '@/types/app.js';
import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';
import type { PlayRelease } from '@/types/googlePlay.js';
import {
  makeProviderInputFailure,
  type SubmitArtifact,
  type Submitter,
} from '@/types/providers.js';
import { GoogleStoreClientService } from '@/services/stores/googleStoreClient.js';

function copyReleaseNote(releaseNote: AndroidReleaseNote): AndroidReleaseNote {
  return { ...releaseNote };
}

function playReleaseFor(
  rollout: number,
  releaseNotes: readonly AndroidReleaseNote[] | undefined,
): Omit<PlayRelease, 'versionCodes'> {
  let release: Omit<PlayRelease, 'versionCodes'> = { status: 'completed' };
  const isPartialRollout = rollout < 1;

  if (isPartialRollout) {
    release = { status: 'inProgress', userFraction: rollout };
  }

  if (releaseNotes == null) {
    return release;
  }

  const notesAreEmpty = releaseNotes.length == 0;

  if (notesAreEmpty) {
    return release;
  }

  return { ...release, releaseNotes: releaseNotes.map(copyReleaseNote) };
}

async function submitAndroidBundle(
  artifact: SubmitArtifact,
  buildCredentials: BuildCredentials,
  buildContext: ResolvedBuildContext,
): Promise<void> {
  const isAndroidCredential = buildCredentials.platform == 'android';

  if (isAndroidCredential == false) {
    throw makeProviderInputFailure({
      provider: 'google-play',
      message: 'The google-play submitter handles Android only.',
    });
  }

  const packageName = buildContext.app.packageName;

  if (packageName == null) {
    throw makeProviderInputFailure({
      provider: 'google-play',
      message: `No Android application id for ${buildContext.app.name}. Set android.package in app.json.`,
    });
  }

  let track: PlayTrack = 'internal';

  if (buildContext.android?.track != null) {
    track = buildContext.android.track;
  }

  let rollout = 1.0;

  if (buildContext.android?.rollout != null) {
    rollout = buildContext.android.rollout;
  }

  const release = playReleaseFor(rollout, buildContext.android?.releaseNotes);
  const playClient = GoogleStoreClientService.createEffectClient(
    buildCredentials.serviceAccountJson,
  );
  const bundleStream = createReadStream(artifact.path);

  try {
    await playClient.uploadBundleToTrack(packageName, bundleStream, track, release);
  } finally {
    bundleStream.destroy();
  }
}

export const googlePlaySubmitter: Submitter = {
  name: 'google-play',
  submit: submitAndroidBundle,
};
