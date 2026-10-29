import { Effect } from 'effect';
import { describe, expect, test } from 'vitest';
import type { ServiceAccount } from '../types/credentials.js';
import {
  GoogleAccessToken,
  GoogleAccessTokenLive,
  makeGoogleAccessTokenTest,
} from './googleAccessToken.js';

const SERVICE_ACCOUNT: ServiceAccount = {
  clientEmail: 'robot@project.iam.gserviceaccount.com',
  privateKey: 'not-a-real-key',
  tokenUri: 'http://127.0.0.1:1/token',
};

describe('makeGoogleAccessTokenTest', () => {
  test('reads every key as the given service account and returns the given token', async () => {
    const program = Effect.gen(function* () {
      const googleAccessToken = yield* GoogleAccessToken;
      const account = yield* googleAccessToken.readServiceAccount('{}');
      const token = yield* googleAccessToken.createAccessToken(account, ['scope']);
      return { account, token };
    });

    const reply = await Effect.runPromise(
      program.pipe(Effect.provide(makeGoogleAccessTokenTest(SERVICE_ACCOUNT, 'token-1'))),
    );

    expect(reply).toEqual({ account: SERVICE_ACCOUNT, token: 'token-1' });
  });
});

describe('GoogleAccessTokenLive', () => {
  test('turns text that is not a service account into a failure', async () => {
    const program = Effect.gen(function* () {
      const googleAccessToken = yield* GoogleAccessToken;
      return yield* googleAccessToken.readServiceAccount('not json');
    });

    const failure = await Effect.runPromise(
      program.pipe(Effect.flip, Effect.provide(GoogleAccessTokenLive)),
    );

    expect(failure._tag).toBe('GoogleAccessTokenFailure');
  });

  test('turns a token request with an unusable key into a failure', async () => {
    const program = Effect.gen(function* () {
      const googleAccessToken = yield* GoogleAccessToken;
      return yield* googleAccessToken.createAccessToken(SERVICE_ACCOUNT, ['scope']);
    });

    const failure = await Effect.runPromise(
      program.pipe(Effect.flip, Effect.provide(GoogleAccessTokenLive)),
    );

    expect(failure._tag).toBe('GoogleAccessTokenFailure');
    expect(failure.message).toContain('Could not get a Google access token');
  });
});
