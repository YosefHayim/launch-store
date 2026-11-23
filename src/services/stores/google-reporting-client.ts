// Opens the Google Play Developer Reporting client from a service-account key.

import { PlayReportingClient } from '@/google/play-reporting.js';
import { readServiceAccount } from '@/google/play-client.js';

type GoogleReportingClientFailure = Readonly<{
  _tag: 'GoogleReportingClientFailure';
  message: string;
  cause: unknown;
}>;

function makeGoogleReportingClientFailure(cause: unknown): GoogleReportingClientFailure {
  return {
    _tag: 'GoogleReportingClientFailure',
    message: 'Could not create the Play Developer Reporting client.',
    cause,
  };
}

function createPlayReportingClient(serviceAccountJson: string): PlayReportingClient {
  try {
    const serviceAccount = readServiceAccount(serviceAccountJson);
    return new PlayReportingClient(serviceAccount);
  } catch (cause) {
    throw makeGoogleReportingClientFailure(cause);
  }
}

export const GoogleReportingClientService = {
  createClient: createPlayReportingClient,
};

export type GoogleReportingClientService = typeof GoogleReportingClientService;
