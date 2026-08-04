import { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import type { SubmitTarget } from '@core/types/app.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import { makeProviderInputFailure, type Submitter } from '@core/types/providers.js';
import { executeCommand, provideNodeCommandServices } from '@core/services/exec.js';

export const appStoreConnectSubmitter: Submitter = {
  name: 'app-store-connect',
  submit(
    artifactPath: string,
    _target: SubmitTarget,
    buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ) {
    if (buildCredentials.platform !== 'ios') {
      return Effect.fail(
        makeProviderInputFailure({
          provider: 'app-store-connect',
          message: 'The app-store-connect submitter handles iOS only.',
        }),
      );
    }
    return Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'launch-key-',
        });
        const apiKeyPath = pathService.join(temporaryDirectory, 'asc_api_key.json');
        yield* fileSystem.writeFileString(
          apiKeyPath,
          JSON.stringify({
            key_id: buildCredentials.ascKey.keyId,
            issuer_id: buildCredentials.ascKey.issuerId,
            key: buildCredentials.ascKey.p8,
            in_house: false,
          }),
        );
        yield* provideNodeCommandServices(
          executeCommand(
            'fastlane',
            [
              'pilot',
              'upload',
              '--ipa',
              artifactPath,
              '--api_key_path',
              apiKeyPath,
              '--skip_waiting_for_build_processing',
              'true',
            ],
            { environmentOverrides: buildContext.env },
          ),
        );
      }),
    ).pipe(Effect.provide(NodeContext.layer));
  },
};
