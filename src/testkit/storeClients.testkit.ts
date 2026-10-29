import type { PlayReportingApp, PlayReportingClient } from '@google/playReporting.js';
import { Effect } from 'effect';
import type { EffectAppStoreConnectClient } from '../core/services/appleStoreClient.js';

export interface FakeAscApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

/** An App Store Connect client that answers only `listApps`, with the given apps or a failure. */
export const makeFakeAscClient = (
  appsOrFailure: readonly FakeAscApp[] | Error,
): EffectAppStoreConnectClient => {
  const fakeClient = {
    listApps: () => {
      if (appsOrFailure instanceof Error) return Effect.fail(appsOrFailure);
      return Effect.succeed(appsOrFailure);
    },
  };
  return fakeClient as unknown as EffectAppStoreConnectClient;
};

/** A Play reporting client that answers only `listApps`, with the given apps or a failure. */
export const makeFakePlayReportingClient = (
  appsOrFailure: readonly PlayReportingApp[] | Error,
): PlayReportingClient => {
  const fakeClient = {
    listApps: () => {
      if (appsOrFailure instanceof Error) return Effect.fail(appsOrFailure);
      return Effect.succeed(appsOrFailure);
    },
  };
  return fakeClient as unknown as PlayReportingClient;
};
