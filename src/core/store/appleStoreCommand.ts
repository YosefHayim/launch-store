import type { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import { loadActiveAscKey } from '../credentials/accounts.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';

/** Loading the active Apple account or creating its transport client failed. */
export type ActiveAppleStoreFailure = Readonly<{
  readonly _tag: 'ActiveAppleStoreFailure';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeActiveAppleStoreFailure =
  Data.tagged<ActiveAppleStoreFailure>('ActiveAppleStoreFailure');

export type ActiveAppleStoreRequirements =
  | AppleStoreClientRequirements
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path;

/** Load the active keychain-backed Apple account and create its Effect transport client. */
export const loadActiveAppleStore = (): Effect.Effect<
  EffectAppStoreConnectClient,
  ActiveAppleStoreFailure,
  ActiveAppleStoreRequirements
> =>
  Effect.gen(function* () {
    const ascKey = yield* loadActiveAscKey().pipe(
      Effect.mapError((cause) =>
        makeActiveAppleStoreFailure({
          message: 'Could not load the active Apple account.',
          cause,
        }),
      ),
    );
    if (ascKey === null) {
      return yield* Effect.fail(
        makeActiveAppleStoreFailure({
          message: 'No active Apple account. Run `launch creds set-key` first.',
          cause: 'missing-active-account',
        }),
      );
    }
    const appleStoreClients = yield* AppleStoreClientService;
    return yield* appleStoreClients.createEffectClient(ascKey).pipe(
      Effect.mapError((cause) =>
        makeActiveAppleStoreFailure({
          message: 'Could not create the App Store Connect client.',
          cause,
        }),
      ),
    );
  });
