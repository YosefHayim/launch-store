import { GooglePlayClient, parseServiceAccount } from '@google/playClient.js';
import { Context, Data, Effect, Layer } from 'effect';

/** Effect-native Google Play transport surface. */
export type EffectGooglePlayClient = GooglePlayClient;

/** A Google Play transport request failed. */
export type GoogleTransportFailure = Readonly<{
  readonly _tag: 'GoogleTransportFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeGoogleTransportFailure =
  Data.tagged<GoogleTransportFailure>('GoogleTransportFailure');

/** Convert a Google transport cause to its tagged error channel. */
const transportFailure = (cause: unknown): GoogleTransportFailure => {
  let message = String(cause);
  if (cause instanceof Error) message = cause.message;
  return makeGoogleTransportFailure({ message, cause });
};

/** Decode credentials and construct the Effect-native Google Play adapter. */
const createGooglePlayClient = (
  serviceAccountJson: string,
): Effect.Effect<EffectGooglePlayClient, GoogleTransportFailure> =>
  parseServiceAccount(serviceAccountJson).pipe(
    Effect.map((serviceAccount) => new GooglePlayClient(serviceAccount)),
    Effect.mapError(transportFailure),
  );

/** Injectable Google Play client factory. */
export type GoogleStoreClientService = Readonly<{
  createClient: (
    serviceAccountJson: string,
  ) => Effect.Effect<GooglePlayClient, GoogleTransportFailure>;
  createEffectClient: (
    serviceAccountJson: string,
  ) => Effect.Effect<EffectGooglePlayClient, GoogleTransportFailure>;
}>;

export const GoogleStoreClientService = Context.GenericTag<GoogleStoreClientService>(
  'GoogleStoreClientService',
);

/** Live Google Play transport factory. */
export const GoogleStoreClientLive = Layer.succeed(GoogleStoreClientService, {
  createClient: createGooglePlayClient,
  createEffectClient: createGooglePlayClient,
} satisfies GoogleStoreClientService);
