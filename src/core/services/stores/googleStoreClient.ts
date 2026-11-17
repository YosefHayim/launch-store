import { Context, Data, Effect, Layer } from 'effect';
import {
  isGooglePlayApiError,
  isPlayAppNotFoundError,
  parseServiceAccount,
  type GooglePlayApiError,
  type PlayAppNotFoundError,
} from '../../../play-console-api/api-client.js';
import {
  makePlayConsoleApi,
  type PlayConsoleApi,
} from '../../../play-console-api/play-console-api.js';
import { effectMethodsProxy, type EffectMethods } from '../platform/effectMethodsClient.js';
import { hasMessage } from '../platform/errorMessage.js';

/** Effect-native Google Play transport surface. */
export type EffectGooglePlayClient = EffectMethods<PlayConsoleApi, PlayFailure>;

type PlayFailure = GooglePlayApiError | PlayAppNotFoundError | GoogleTransportFailure;

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
  if (hasMessage(cause)) message = cause.message;
  return makeGoogleTransportFailure({ message, cause });
};

const playFailure = (cause: unknown): PlayFailure => {
  if (isGooglePlayApiError(cause)) return cause;
  if (isPlayAppNotFoundError(cause)) return cause;
  return transportFailure(cause);
};

/** Decode credentials and construct the Effect-native Google Play adapter. */
const createGooglePlayClient = (
  serviceAccountJson: string,
): Effect.Effect<EffectGooglePlayClient, GoogleTransportFailure> =>
  Effect.try({
    try: () =>
      effectMethodsProxy(makePlayConsoleApi(parseServiceAccount(serviceAccountJson)), playFailure),
    catch: transportFailure,
  });

/** Injectable Google Play client factory. */
export type GoogleStoreClientService = Readonly<{
  createClient: (
    serviceAccountJson: string,
  ) => Effect.Effect<EffectGooglePlayClient, GoogleTransportFailure>;
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
