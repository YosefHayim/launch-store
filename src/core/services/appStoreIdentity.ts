// Verifies an App Store Connect key and reads its account identity.
// Team and app discovery are best-effort because Apple exposes them through separate endpoints.

import { Context, Effect, Layer } from 'effect';
import type { AscKey } from '../types/credentials.js';
import {
  type AppleStoreClientService as AppleStoreClientRequirements,
  AppleStoreClientService,
  type AppleTransportFailure,
  type EffectAppStoreConnectClient,
} from './appleStoreClient.js';

/** Non-secret Apple account identity cached beside an imported key. */
export type AppStoreIdentity = Readonly<{
  readonly teamId: string | null;
  readonly apps: string[];
}>;

/** Apple account verification and identity reads used by credential import. */
export type AppStoreIdentityService = Readonly<{
  readonly verifyCredentials: (
    ascKey: AscKey,
  ) => Effect.Effect<AppStoreIdentity, AppleTransportFailure>;
  readonly resolveIdentity: (ascKey: AscKey) => Effect.Effect<AppStoreIdentity>;
}>;

export const AppStoreIdentityService = Context.GenericTag<AppStoreIdentityService>(
  'launch-store/AppStoreIdentityService',
);

const resolveIdentityWith = (
  appStoreClient: EffectAppStoreConnectClient,
): Effect.Effect<AppStoreIdentity> =>
  Effect.all(
    {
      teamId: appStoreClient.resolveTeamId().pipe(Effect.catchAll(() => Effect.succeed(null))),
      apps: appStoreClient.listAppNames().pipe(Effect.catchAll(() => Effect.succeed([]))),
    },
    { concurrency: 'unbounded' },
  );

/** Live Apple account adapter backed by the shared Effect transport service. */
export const AppStoreIdentityLive: Layer.Layer<
  AppStoreIdentityService,
  never,
  AppleStoreClientRequirements
> = Layer.effect(
  AppStoreIdentityService,
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    return {
      verifyCredentials: (ascKey) =>
        Effect.gen(function* () {
          const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
          yield* appStoreClient.assertReady();
          return yield* resolveIdentityWith(appStoreClient);
        }),
      resolveIdentity: (ascKey) =>
        Effect.gen(function* () {
          const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
          return yield* resolveIdentityWith(appStoreClient);
        }),
    } satisfies AppStoreIdentityService;
  }),
);
