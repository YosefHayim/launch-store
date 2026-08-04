import { PlayReportingClient } from '@google/playReporting.js';
import { parseServiceAccount } from '@google/playClient.js';
import { Context, Data, Effect, Layer } from 'effect';

export type GoogleReportingClientFailure = Readonly<{
  readonly _tag: 'GoogleReportingClientFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeGoogleReportingClientFailure = Data.tagged<GoogleReportingClientFailure>(
  'GoogleReportingClientFailure',
);

export type GoogleReportingClientService = Readonly<{
  readonly createClient: (
    serviceAccountJson: string,
  ) => Effect.Effect<PlayReportingClient, GoogleReportingClientFailure>;
}>;

export const GoogleReportingClientService = Context.GenericTag<GoogleReportingClientService>(
  'launch-store/GoogleReportingClient',
);

/** Live Play Developer Reporting client factory backed by Google's generated package. */
export const GoogleReportingClientLive = Layer.succeed(GoogleReportingClientService, {
  createClient: (serviceAccountJson) =>
    parseServiceAccount(serviceAccountJson).pipe(
      Effect.map((serviceAccount) => new PlayReportingClient(serviceAccount)),
      Effect.mapError((cause) =>
        makeGoogleReportingClientFailure({
          message: 'Could not create the Play Developer Reporting client.',
          cause,
        }),
      ),
    ),
} satisfies GoogleReportingClientService);
