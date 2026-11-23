// Opens a Google Play client and turns a transport failure into a named error.

import { GooglePlayClient, readServiceAccount } from '@/google/play-client.js';
import { hasMessage } from '../platform/error-message.ts';

export type GoogleTransportFailure = Readonly<{
  _tag: 'GoogleTransportFailure';
  message: string;
  cause: unknown;
}>;

export function makeGoogleTransportFailure(fields: {
  message: string;
  cause: unknown;
}): GoogleTransportFailure {
  return { _tag: 'GoogleTransportFailure', message: fields.message, cause: fields.cause };
}

function transportFailure(cause: unknown): GoogleTransportFailure {
  let message = String(cause);

  if (hasMessage(cause)) {
    message = cause.message;
  }

  return makeGoogleTransportFailure({ message, cause });
}

function createGooglePlayClient(serviceAccountJson: string): GooglePlayClient {
  try {
    const serviceAccount = readServiceAccount(serviceAccountJson);
    return new GooglePlayClient(serviceAccount);
  } catch (cause) {
    throw transportFailure(cause);
  }
}

export const GoogleStoreClientService = {
  createClient: createGooglePlayClient,
  createEffectClient: createGooglePlayClient,
};

export type GoogleStoreClientService = typeof GoogleStoreClientService;

export type EffectGooglePlayClient = GooglePlayClient;
