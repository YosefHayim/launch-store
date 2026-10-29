import { createServiceAccountAccessToken } from '@google/serviceAccountToken.js';
import { parseServiceAccount } from '@google/playClient.js';
import { Context, Data, Effect, Layer } from 'effect';
import type { ServiceAccount } from '../types/credentials.js';
import { errorMessage } from './errorMessage.js';

export type GoogleAccessTokenFailure = Readonly<{
  readonly _tag: 'GoogleAccessTokenFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

const makeGoogleAccessTokenFailure = Data.tagged<GoogleAccessTokenFailure>(
  'GoogleAccessTokenFailure',
);

export type GoogleAccessTokenService = Readonly<{
  readonly readServiceAccount: (
    savedServiceAccountKey: string,
  ) => Effect.Effect<ServiceAccount, GoogleAccessTokenFailure>;
  readonly createAccessToken: (
    account: ServiceAccount,
    scopes: readonly string[],
  ) => Effect.Effect<string, GoogleAccessTokenFailure>;
}>;

export const GoogleAccessToken = Context.GenericTag<GoogleAccessTokenService>(
  'launch-store/GoogleAccessToken',
);

export const GoogleAccessTokenLive = Layer.succeed(GoogleAccessToken, {
  readServiceAccount: (savedServiceAccountKey) =>
    parseServiceAccount(savedServiceAccountKey).pipe(
      Effect.mapError((cause) =>
        makeGoogleAccessTokenFailure({ message: errorMessage(cause), cause }),
      ),
    ),
  createAccessToken: (account, scopes) =>
    Effect.tryPromise({
      try: () => createServiceAccountAccessToken(account, scopes),
      catch: (cause) =>
        makeGoogleAccessTokenFailure({
          message: `Could not get a Google access token: ${errorMessage(cause)}`,
          cause,
        }),
    }),
} satisfies GoogleAccessTokenService);

export const makeGoogleAccessTokenTest = (
  serviceAccount: ServiceAccount,
  accessToken: string,
): Layer.Layer<GoogleAccessTokenService> =>
  Layer.succeed(GoogleAccessToken, {
    readServiceAccount: () => Effect.succeed(serviceAccount),
    createAccessToken: () => Effect.succeed(accessToken),
  } satisfies GoogleAccessTokenService);
