import { Effect, unsafeCoerce } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../credentials/accounts.js', () => ({ loadActiveAscKey: vi.fn() }));
vi.mock('../credentials/androidKeystore.js', () => ({ loadServiceAccount: vi.fn() }));

import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import {
  type AppleStoreClientService,
  AppleStoreClientService as AppleStoreClients,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import {
  type EffectGooglePlayClient,
  type GoogleStoreClientService,
  GoogleStoreClientService as GoogleStoreClients,
} from '../services/googleStoreClient.js';
import { createAscClientResolver, createPlayClientResolver } from './storeClients.js';

const appStoreClient = unsafeCoerce<unknown, EffectAppStoreConnectClient>({ store: 'apple' });
const playStoreClient = unsafeCoerce<unknown, EffectGooglePlayClient>({ store: 'google' });

const createEffectAppStoreClient = vi.fn(() => Effect.succeed(appStoreClient));
const createEffectPlayStoreClient = vi.fn(() => Effect.succeed(playStoreClient));

const appleStoreClientTest = unsafeCoerce<
  Pick<AppleStoreClientService, 'createEffectClient'>,
  AppleStoreClientService
>({ createEffectClient: createEffectAppStoreClient });

const googleStoreClientTest = unsafeCoerce<
  Pick<GoogleStoreClientService, 'createEffectClient'>,
  GoogleStoreClientService
>({ createEffectClient: createEffectPlayStoreClient });

const runTest = <Success, Failure, Requirements>(
  testEffect: Effect.Effect<Success, Failure, Requirements>,
): Promise<Success> =>
  Effect.runPromise(
    unsafeCoerce<Effect.Effect<Success, Failure, Requirements>, Effect.Effect<Success, Failure>>(
      testEffect,
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAscClientResolver', () => {
  it('loads credentials and constructs the client once', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(
      Effect.succeed({ keyId: 'K', issuerId: 'I', p8: 'pem' }),
    );
    const resolveAppStoreClient = createAscClientResolver();
    const runResolver = () =>
      runTest(
        resolveAppStoreClient().pipe(
          Effect.provideService(AppleStoreClients, appleStoreClientTest),
        ),
      );

    const firstClient = await runResolver();
    const secondClient = await runResolver();
    expect(firstClient).toBe(secondClient);
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(createEffectAppStoreClient).toHaveBeenCalledTimes(1);
  });

  it('caches an unconfigured account without creating a client', async () => {
    vi.mocked(loadActiveAscKey).mockReturnValue(Effect.succeed(null));
    const resolveAppStoreClient = createAscClientResolver();
    const runResolver = () =>
      runTest(
        resolveAppStoreClient().pipe(
          Effect.provideService(AppleStoreClients, appleStoreClientTest),
        ),
      );

    expect(await runResolver()).toBeNull();
    expect(await runResolver()).toBeNull();
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(createEffectAppStoreClient).not.toHaveBeenCalled();
  });
});

describe('createPlayClientResolver', () => {
  it('loads the service account and constructs the client once', async () => {
    vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed('{}'));
    const resolvePlayStoreClient = createPlayClientResolver();
    const runResolver = () =>
      runTest(
        resolvePlayStoreClient().pipe(
          Effect.provideService(GoogleStoreClients, googleStoreClientTest),
        ),
      );

    const firstClient = await runResolver();
    const secondClient = await runResolver();
    expect(firstClient).toBe(secondClient);
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(createEffectPlayStoreClient).toHaveBeenCalledTimes(1);
  });

  it('caches an unconfigured account without creating a client', async () => {
    vi.mocked(loadServiceAccount).mockReturnValue(Effect.succeed(null));
    const resolvePlayStoreClient = createPlayClientResolver();
    const runResolver = () =>
      runTest(
        resolvePlayStoreClient().pipe(
          Effect.provideService(GoogleStoreClients, googleStoreClientTest),
        ),
      );

    expect(await runResolver()).toBeNull();
    expect(await runResolver()).toBeNull();
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(createEffectPlayStoreClient).not.toHaveBeenCalled();
  });
});
