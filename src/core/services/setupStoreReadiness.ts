// Store probes used while setting up Apple and Google projects.

import { Context, Effect, Layer } from 'effect';
import type { AscKey } from '../types/credentials.js';
import {
  type AppleStoreClientService as AppleStoreClientRequirements,
  AppleStoreClientService,
  type AppleTransportFailure,
} from './appleStoreClient.js';
import {
  type GoogleStoreClientService as GoogleStoreClientRequirements,
  GoogleStoreClientService,
  type GoogleTransportFailure,
  makeGoogleTransportFailure,
} from './googleStoreClient.js';

/** Read-only checks required before setup can continue. */
export type SetupStoreReadinessService = Readonly<{
  readonly checkAppleAgreements: (ascKey: AscKey) => Effect.Effect<void, AppleTransportFailure>;
  readonly checkAppleApp: (
    ascKey: AscKey,
    bundleId: string,
  ) => Effect.Effect<boolean, AppleTransportFailure>;
  readonly checkPlayApp: (
    serviceAccountJson: string,
    packageName: string,
  ) => Effect.Effect<void, GoogleTransportFailure>;
}>;

export const SetupStoreReadiness = Context.GenericTag<SetupStoreReadinessService>(
  'launch-store/SetupStoreReadiness',
);

/** Live readiness checks backed by the shared store transports. */
export const SetupStoreReadinessLive: Layer.Layer<
  SetupStoreReadinessService,
  never,
  AppleStoreClientRequirements | GoogleStoreClientRequirements
> = Layer.effect(
  SetupStoreReadiness,
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    const googleStoreClients = yield* GoogleStoreClientService;
    return {
      checkAppleAgreements: (ascKey) =>
        Effect.gen(function* () {
          const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
          yield* appStoreClient.assertReady();
        }),
      checkAppleApp: (ascKey, bundleId) =>
        Effect.gen(function* () {
          const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
          const appId = yield* appStoreClient.getAppId(bundleId);
          return appId !== null;
        }),
      checkPlayApp: (serviceAccountJson, packageName) =>
        Effect.gen(function* () {
          const playStoreClient = yield* googleStoreClients.createEffectClient(serviceAccountJson);
          yield* playStoreClient
            .assertAppExists(packageName)
            .pipe(
              Effect.mapError((cause) =>
                makeGoogleTransportFailure({ message: cause.message, cause }),
              ),
            );
        }),
    } satisfies SetupStoreReadinessService;
  }),
);

export const makeSetupStoreReadinessTest = (
  setupStoreReadiness: SetupStoreReadinessService,
): Layer.Layer<SetupStoreReadinessService> =>
  Layer.succeed(SetupStoreReadiness, setupStoreReadiness);
