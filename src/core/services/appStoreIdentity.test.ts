import { Effect, Layer, unsafeCoerce } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  type AppleStoreClientService,
  AppleStoreClientService as AppleStoreClients,
  makeAppleTransportFailure,
  type EffectAppStoreConnectClient,
} from './appleStoreClient.js';
import {
  AppStoreIdentityLive,
  AppStoreIdentityService,
  type AppStoreIdentityService as AppStoreIdentityTestService,
} from './appStoreIdentity.js';

const ascKey = { keyId: 'key', issuerId: 'issuer', p8: 'secret' };

const identityProgram = (
  appStoreClient: Pick<
    EffectAppStoreConnectClient,
    'assertReady' | 'resolveTeamId' | 'listAppNames'
  >,
): Effect.Effect<AppStoreIdentityTestService> => {
  const clientFactory = unsafeCoerce<
    Pick<AppleStoreClientService, 'createEffectClient'>,
    AppleStoreClientService
  >({
    createEffectClient: () =>
      Effect.succeed(
        unsafeCoerce<typeof appStoreClient, EffectAppStoreConnectClient>(appStoreClient),
      ),
  });
  const appleTransportTest = Layer.succeed(AppleStoreClients, clientFactory);
  const identityTest = AppStoreIdentityLive.pipe(Layer.provide(appleTransportTest));
  return AppStoreIdentityService.pipe(Effect.provide(identityTest));
};

const failure = makeAppleTransportFailure({
  message: 'Unauthorized',
  cause: new Error('Unauthorized'),
  status: 401,
});

describe('AppStoreIdentityService', () => {
  it('verifies the key before returning its best-effort identity', async () => {
    const assertReady = vi.fn(() => Effect.void);
    const identityService = await Effect.runPromise(
      identityProgram({
        assertReady,
        resolveTeamId: () => Effect.succeed('TEAM1'),
        listAppNames: () => Effect.succeed(['One', 'Two']),
      }),
    );

    await expect(Effect.runPromise(identityService.verifyCredentials(ascKey))).resolves.toEqual({
      teamId: 'TEAM1',
      apps: ['One', 'Two'],
    });
    expect(assertReady).toHaveBeenCalledOnce();
  });

  it('keeps verification failures in the typed error channel', async () => {
    const identityService = await Effect.runPromise(
      identityProgram({
        assertReady: () => Effect.fail(failure),
        resolveTeamId: () => Effect.succeed('TEAM1'),
        listAppNames: () => Effect.succeed(['One']),
      }),
    );

    await expect(
      Effect.runPromise(identityService.verifyCredentials(ascKey).pipe(Effect.flip)),
    ).resolves.toMatchObject({
      _tag: 'AppleTransportFailure',
      status: 401,
    });
  });

  it('does not reject a verified key when identity discovery is unavailable', async () => {
    const identityService = await Effect.runPromise(
      identityProgram({
        assertReady: () => Effect.void,
        resolveTeamId: () => Effect.fail(failure),
        listAppNames: () => Effect.fail(failure),
      }),
    );

    await expect(Effect.runPromise(identityService.verifyCredentials(ascKey))).resolves.toEqual({
      teamId: null,
      apps: [],
    });
  });
});
