import { Terminal } from '@effect/platform';
import { Data, Effect } from 'effect';
import {
  loadServiceAccount,
  describeMissingPlayServiceAccount,
} from '../credentials/androidKeystore.js';
import {
  GoogleStoreClientService,
  type EffectGooglePlayClient,
  type GoogleStoreClientService as GoogleStoreClientRequirements,
} from '../services/googleStoreClient.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import {
  makeStoreAppSelectionFailure,
  selectStoreApp,
  type StoreAppSelectionFailure,
  type StoreAppSelectionRequirements,
} from './selectStoreApp.js';

/** Loading the Play service account or creating its transport client failed. */
export type ActiveGoogleStoreFailure = Readonly<{
  readonly _tag: 'ActiveGoogleStoreFailure';
  readonly message: string;
  readonly cause: unknown;
}>;
const makeActiveGoogleStoreFailure = Data.tagged<ActiveGoogleStoreFailure>(
  'ActiveGoogleStoreFailure',
);

export type ActiveGoogleStoreRequirements =
  | GoogleStoreClientRequirements
  | LaunchSecretStoreService;

/** Load the keychain-backed Play service account and create its Effect transport client. */
export const loadActiveGoogleStore = (
  packageName: string,
  appName: string,
): Effect.Effect<EffectGooglePlayClient, ActiveGoogleStoreFailure, ActiveGoogleStoreRequirements> =>
  Effect.gen(function* () {
    const serviceAccountJson = yield* loadServiceAccount(packageName).pipe(
      Effect.mapError((cause) =>
        makeActiveGoogleStoreFailure({
          message: 'Could not load the Play service account.',
          cause,
        }),
      ),
    );
    if (serviceAccountJson === null) {
      return yield* Effect.fail(
        makeActiveGoogleStoreFailure({
          message: yield* describeMissingPlayServiceAccount(appName).pipe(
            Effect.mapError((cause) =>
              makeActiveGoogleStoreFailure({
                message: 'Could not read legacy Play credentials.',
                cause,
              }),
            ),
          ),
          cause: 'missing-service-account',
        }),
      );
    }
    const googleStoreClients = yield* GoogleStoreClientService;
    return yield* googleStoreClients.createEffectClient(serviceAccountJson).pipe(
      Effect.mapError((cause) =>
        makeActiveGoogleStoreFailure({
          message: 'Could not create the Google Play client.',
          cause,
        }),
      ),
    );
  });

/** Resolve the selected app's Google Play package name. */
export const resolveGoogleStoreApp = (
  appSelector: string | undefined,
): Effect.Effect<
  { packageName: string; appName: string },
  StoreAppSelectionFailure,
  StoreAppSelectionRequirements
> =>
  Effect.gen(function* () {
    const selectedApp = yield* selectStoreApp(appSelector);
    if (selectedApp.packageName !== undefined)
      return { packageName: selectedApp.packageName, appName: selectedApp.name };
    return yield* Effect.fail(
      makeStoreAppSelectionFailure({
        message: `No Android application id for ${selectedApp.name} (set android.package in app.json).`,
        cause: selectedApp,
      }),
    );
  });

/** A Google Play command confirmation failed or was unavailable. */
export type GoogleStoreConfirmationFailure = Readonly<{
  readonly _tag: 'GoogleStoreConfirmationFailure';
  readonly message: string;
  readonly cause: unknown;
}>;
const makeGoogleStoreConfirmationFailure = Data.tagged<GoogleStoreConfirmationFailure>(
  'GoogleStoreConfirmationFailure',
);

/** Confirm an outward-facing Google Play write. */
export const confirmGoogleStoreWrite = (
  confirmationMessage: string,
  assumeYes: boolean,
  refusalMessage: string,
  cancellationMessage: string,
): Effect.Effect<
  boolean,
  GoogleStoreConfirmationFailure,
  LaunchPromptService | Terminal.Terminal
> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeGoogleStoreConfirmationFailure({
          message: refusalMessage,
          cause: 'confirmation-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(confirmationMessage)
      .pipe(
        Effect.mapError((cause) =>
          makeGoogleStoreConfirmationFailure({ message: cause.message, cause }),
        ),
      );
    if (confirmed) return true;
    yield* prompt.cancel(cancellationMessage);
    return false;
  });
