import type { PlayReportingApp, PlayReportingClient } from '../google/play-reporting.ts';
import type { AppStoreConnectClient } from '../apple/asc-client.ts';

interface FakeAscApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

function isError(candidate: object): candidate is Error {
  return candidate instanceof Error;
}

export function makeFakeAscClient(
  appsOrFailure: readonly FakeAscApp[] | Error,
): AppStoreConnectClient {
  async function listApps(): Promise<FakeAscApp[]> {
    if (isError(appsOrFailure)) {
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
    if (isError(appsOrFailure)) {
      throw appsOrFailure;
    }

    return [...appsOrFailure];
  }

  // Only listApps is exercised; the rest of the client is unused by these tests.
  return { listApps } as unknown as PlayReportingClient;
}
