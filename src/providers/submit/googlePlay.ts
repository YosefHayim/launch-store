import { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import type { AndroidReleaseNote, PlayTrack, SubmitTarget } from '@core/types/app.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import { makeProviderInputFailure, type Submitter } from '@core/types/providers.js';
import { executeCommand, provideNodeCommandServices } from '@core/services/exec.js';

/** Listing/asset uploads Launch never manages - supply must skip them or it errors on missing files. */
const SKIP_LISTING_BASE = [
  '--skip_upload_metadata',
  'true',
  '--skip_upload_images',
  'true',
  '--skip_upload_screenshots',
  'true',
] as const;

/**
 * Write supply's changelog layout under `metadataDirectory`: one `changelogs/default.txt` per locale.
 * `default.txt` is supply's fallback when a versionCode-named file is absent, so notes attach to the
 * AAB being uploaded without the submitter needing the stamped versionCode.
 */
const writeChangelogMetadata = (
  metadataDirectory: string,
  releaseNotes: readonly AndroidReleaseNote[],
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    for (const releaseNote of releaseNotes) {
      const changelogDirectory = pathService.join(
        metadataDirectory,
        releaseNote.language,
        'changelogs',
      );
      yield* fileSystem.makeDirectory(changelogDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        pathService.join(changelogDirectory, 'default.txt'),
        releaseNote.text,
      );
    }
  });

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
    const releaseNotes = buildContext.android?.releaseNotes;
    let hasReleaseNotes = false;
    if (releaseNotes !== undefined && releaseNotes.length > 0) hasReleaseNotes = true;
    return Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'launch-play-',
        });
        const jsonKeyPath = pathService.join(temporaryDirectory, 'play-service-account.json');
        yield* fileSystem.writeFileString(jsonKeyPath, buildCredentials.serviceAccountJson);
        const args: string[] = [
          'supply',
          '--aab',
          artifactPath,
          '--json_key',
          jsonKeyPath,
          '--package_name',
          packageName,
          '--track',
          track,
          ...SKIP_LISTING_BASE,
        ];
        if (hasReleaseNotes && releaseNotes !== undefined) {
          const metadataDirectory = pathService.join(temporaryDirectory, 'metadata');
          yield* writeChangelogMetadata(metadataDirectory, releaseNotes);
          args.push('--metadata_path', metadataDirectory);
        } else {
          // No notes configured: skip changelogs so supply does not require a metadata tree.
          args.push('--skip_upload_changelogs', 'true');
        }
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
