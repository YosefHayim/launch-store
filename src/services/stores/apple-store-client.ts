import { AppStoreConnectClient } from '../../apple/asc-client.ts';
import type { AscKey } from '../../types/credentials.ts';
import { hasMessage } from '../platform/error-message.ts';

export type AppleTransportFailure = Readonly<{
  _tag: 'AppleTransportFailure';
  message: string;
  cause: unknown;
  status?: number;
}>;

export function makeAppleTransportFailure(fields: {
  message: string;
  cause: unknown;
  status?: number;
}): AppleTransportFailure {
  if (fields.status == null) {
    return { _tag: 'AppleTransportFailure', message: fields.message, cause: fields.cause };
  }

  return {
    _tag: 'AppleTransportFailure',
    message: fields.message,
    cause: fields.cause,
    status: fields.status,
  };
}

function transportFailure(cause: unknown): AppleTransportFailure {
  let message = String(cause);

  if (hasMessage(cause)) {
    message = cause.message;
  }

  if (typeof cause != 'object') {
    return makeAppleTransportFailure({ message, cause });
  }

  if (cause == null) {
    return makeAppleTransportFailure({ message, cause });
  }

  if ('status' in cause == false) {
    return makeAppleTransportFailure({ message, cause });
  }

  const status = cause.status;

  if (typeof status != 'number') {
    return makeAppleTransportFailure({ message, cause });
  }

  return makeAppleTransportFailure({ message, cause, status });
}

export function appRecordMissingMessage(
  bundleId: string,
  command = 'launch-store release ios',
): string {
  return (
    `No App Store Connect app record for ${bundleId}. Apple has no API to create one - create the app ` +
    `once at https://appstoreconnect.apple.com/apps. A brand-new app also needs its screenshots, age rating, ` +
    `privacy details, and signed Paid/Free Apps agreement set there once. Then re-run \`${command}\`.`
  );
}

function wrapAppleClient(client: AppStoreConnectClient): AppStoreConnectClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);

      if (typeof member != 'function') {
        return member;
      }

      return async function callApple(...methodArguments: unknown[]) {
        try {
          return await Reflect.apply(member, target, methodArguments);
        } catch (cause) {
          throw transportFailure(cause);
        }
      };
    },
  });
}

type AppleClientFactory = (ascKey: AscKey) => AppStoreConnectClient;

let appleClientFactory: AppleClientFactory | null = null;

export function useAppleStoreClientFactory(factory: AppleClientFactory | null): void {
  appleClientFactory = factory;
}

function createAppleClient(ascKey: AscKey): AppStoreConnectClient {
  if (appleClientFactory != null) {
    return appleClientFactory(ascKey);
  }

  return wrapAppleClient(new AppStoreConnectClient(ascKey));
}

export const AppleStoreClientService = {
  createClient: createAppleClient,
  createEffectClient: createAppleClient,
  createReleaseAttributesClient: createAppleClient,
};

export type AppleStoreClientService = typeof AppleStoreClientService;
export type EffectAppStoreConnectClient = AppStoreConnectClient;
