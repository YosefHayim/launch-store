// Opens the Google Play Developer Reporting client from a service-account key.

import { PlayReportingClient } from '../../google/play-reporting.ts';
import { readServiceAccount } from '../../google/play-client.ts';

function createPlayReportingClient(serviceAccountJson: string): PlayReportingClient {
  try {
    const serviceAccount = readServiceAccount(serviceAccountJson);
    return new PlayReportingClient(serviceAccount);
  } catch (cause) {
    throw new Error('Could not create the Play Developer Reporting client.', { cause });
  }
}

export class GoogleReportingClientService {
  createClient(serviceAccountJson: string): PlayReportingClient {
    return createPlayReportingClient(serviceAccountJson);
  }
}
