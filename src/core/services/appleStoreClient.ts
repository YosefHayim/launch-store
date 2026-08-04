import { Context, Data, Effect, Layer } from 'effect';
import { AppStoreConnectClient } from '@apple/ascClient.js';
import type { AscReleaseApi as PublicReleaseApi } from '../release/appStoreRelease.js';
import type { AscReleaseApi as ReleaseAttributesApi } from '../release/releaseAttrs.js';
import type { AscKey } from '../types/credentials.js';
import { effectMethodsProxy, type EffectMethods } from './effectMethodsClient.js';

export type EffectAppStoreConnectClient = EffectMethods<
  AppStoreConnectClient,
  AppleTransportFailure
>;

export type AppleTransportFailure = Readonly<{
  readonly _tag: 'AppleTransportFailure';
  readonly message: string;
  readonly cause: unknown;
  readonly status?: number;
}>;

export const makeAppleTransportFailure =
  Data.tagged<AppleTransportFailure>('AppleTransportFailure');

const transportFailure = (cause: unknown): AppleTransportFailure => {
  let message = String(cause);
  if (cause instanceof Error) message = cause.message;
  if (typeof cause !== 'object') {
    return makeAppleTransportFailure({ message, cause });
  }
  if (cause === null) {
    return makeAppleTransportFailure({ message, cause });
  }
  if (!('status' in cause)) {
    return makeAppleTransportFailure({ message, cause });
  }
  const status = cause.status;
  if (typeof status !== 'number') return makeAppleTransportFailure({ message, cause });
  return makeAppleTransportFailure({ message, cause, status });
};

const effectClient = (ascKey: AscKey): EffectAppStoreConnectClient => {
  const promiseClient = new AppStoreConnectClient(ascKey);
  return effectMethodsProxy(promiseClient, transportFailure);
};

export type AppleStoreClientService = Readonly<{
  createClient: (ascKey: AscKey) => Effect.Effect<PublicReleaseApi>;
  createEffectClient: (ascKey: AscKey) => Effect.Effect<EffectAppStoreConnectClient>;
  createReleaseAttributesClient: (ascKey: AscKey) => Effect.Effect<ReleaseAttributesApi>;
}>;

export const AppleStoreClientService =
  Context.GenericTag<AppleStoreClientService>('AppleStoreClientService');

export const AppleStoreClientLive = Layer.succeed(AppleStoreClientService, {
  createClient: (ascKey) => Effect.sync((): PublicReleaseApi => effectClient(ascKey)),
  createEffectClient: (ascKey) => Effect.sync(() => effectClient(ascKey)),
  createReleaseAttributesClient: (ascKey) =>
    Effect.sync((): ReleaseAttributesApi => effectClient(ascKey)),
} satisfies AppleStoreClientService);
