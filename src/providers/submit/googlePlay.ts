import { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import type { PlayTrack, SubmitTarget } from '@core/types/app.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import { makeProviderInputFailure, type Submitter } from '@core/types/providers.js';
import { executeCommand, provideNodeCommandServices } from '@core/services/exec.js';
/** Metadata/asset uploads Launch never manages - supply must skip them or it errors on missing files. */
const SKIP_LISTING_FLAGS = [
  '--skip_upload_metadata',
  'true',
  '--skip_upload_images',
  'true',
  '--skip_upload_screenshots',
  'true',
  '--skip_upload_changelogs',
  'true',
];
export const googlePlaySubmitter: Submitter = {
  name: 'google-play',
  submit(
    artifactPath: string,
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
    return Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'launch-play-',
        });
        const jsonKeyPath = pathService.join(temporaryDirectory, 'play-service-account.json');
        yield* fileSystem.writeFileString(jsonKeyPath, buildCredentials.serviceAccountJson);
        const args = [
          'supply',
          '--aab',
          artifactPath,
          '--json_key',
          jsonKeyPath,
          '--package_name',
          packageName,
          '--track',
          track,
          ...SKIP_LISTING_FLAGS,
        ];
        // A partial rollout becomes a staged ("inProgress") release; a full one is left to complete.
        if (rollout < 1) args.push('--rollout', String(rollout));
        // Resolved env (profile env: / .env / keychain / --env) reaches fastlane as its process env.
        yield* provideNodeCommandServices(
          executeCommand('fastlane', args, { environmentOverrides: buildContext.env }),
        );
      }),
    ).pipe(Effect.provide(NodeContext.layer));
  },
};
