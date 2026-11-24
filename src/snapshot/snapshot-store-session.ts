// Opens App Store Connect and Google Play for the apps a snapshot command selected.

import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import type { AppStoreConnect } from '../apple/app-store-connect.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { createPlayClientReader } from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { SnapshotContext } from '../types/snapshot.ts';
import { snapshotFailure } from './snapshot-failure.ts';

export const LIVE_SNAPSHOT = 'live';

export type PlayClientReader = ReturnType<typeof createPlayClientReader>;

export type SnapshotStoreSession = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  ascClient: AppStoreConnect | null;
  playClient: PlayClientReader;
}>;

export function currentIsoTime(): string {
  return new Date(Date.now()).toISOString();
}

async function selectSnapshotApps(
  discoveredApps: readonly AppDescriptor[],
  appSelector: string | undefined,
): Promise<readonly AppDescriptor[]> {
  try {
    return await selectApps(discoveredApps, appSelector);
  } catch (cause) {
    throw snapshotFailure('select snapshot apps', cause);
  }
}

function createAscClient(ascKey: NonNullable<Awaited<ReturnType<typeof loadActiveAscKey>>>) {
  try {
    return new AppleStoreClientService().createClient(ascKey);
  } catch (cause) {
    throw snapshotFailure('create App Store client', cause);
  }
}

export async function loadSnapshotStoreSession(
  appSelector: string | undefined,
): Promise<SnapshotStoreSession> {
  try {
    var loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw snapshotFailure('load Launch configuration', cause);
  }

  try {
    var ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw snapshotFailure('load active Apple account', cause);
  }

  let ascClient: AppStoreConnect | null = null;

  if (ascKey != null) {
    ascClient = createAscClient(ascKey);
  }

  const playClient = createPlayClientReader();
  const selectedApps = await selectSnapshotApps(loadedConfiguration.apps, appSelector);

  return {
    config: loadedConfiguration.config,
    apps: selectedApps,
    ascClient,
    playClient,
  };
}

export function captureContextFromSession(storeSession: SnapshotStoreSession): SnapshotContext {
  return {
    config: storeSession.config,
    apps: storeSession.apps,
    readAscApi: function readAscApi() {
      return Promise.resolve(storeSession.ascClient);
    },
    readPlayApi: storeSession.playClient,
  };
}
