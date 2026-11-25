import type { PlayReportingApp, PlayReportingClient } from '../google/play-reporting.ts';
import type { AppStoreConnectClient } from '../apple/app-store-connect-client.ts';

interface FakeAscApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

export function makeFakeAscClient(
  appsOrFailure: readonly FakeAscApp[] | Error,
): AppStoreConnectClient {
  async function listApps(): Promise<FakeAscApp[]> {
    if (appsOrFailure instanceof Error) {
      throw appsOrFailure;
    }

    return [...appsOrFailure];
  }

  // Only listApps is exercised; the rest of the client is unused by these tests.
  return { listApps } as unknown as AppStoreConnectClient;
}

export function makeFakePlayReportingClient(
  appsOrFailure: readonly PlayReportingApp[] | Error,
): PlayReportingClient {
  async function listApps(): Promise<PlayReportingApp[]> {
    if (appsOrFailure instanceof Error) {
      throw appsOrFailure;
    }

    return [...appsOrFailure];
  }

  // Only listApps is exercised; the rest of the client is unused by these tests.
  return { listApps } as unknown as PlayReportingClient;
}
