// Opens App Store Connect and Google Play for the apps a snapshot command selected.

import { loadConfig } from '../config/config.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import type { AppStoreConnectClient } from '../apple/app-store-connect-client.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { createPlayClientResolver } from '../store/shared/store-clients.ts';
import { selectApps } from '../store/shared/sync-jobs.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { SnapshotContext } from '../types/snapshot.ts';
import { snapshotFailure } from './snapshot-failure.ts';

export const LIVE_SNAPSHOT = 'live';

export type PlayClientResolver = ReturnType<typeof createPlayClientResolver>;

export type SnapshotStoreSession = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  ascClient: AppStoreConnectClient | null;
  playClient: PlayClientResolver;
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
    return AppleStoreClientService.createClient(ascKey);
  } catch (cause) {
    throw snapshotFailure('create App Store client', cause);
  }
}

export async function loadSnapshotStoreSession(
  appSelector: string | undefined,
): Promise<SnapshotStoreSession> {
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig();
  } catch (cause) {
    throw snapshotFailure('load Launch configuration', cause);
  }

  let ascKey: Awaited<ReturnType<typeof loadActiveAscKey>>;

  try {
    ascKey = await loadActiveAscKey();
  } catch (cause) {
    throw snapshotFailure('load active Apple account', cause);
  }

  let ascClient: AppStoreConnectClient | null = null;

  if (ascKey != null) {
    ascClient = createAscClient(ascKey);
  }

  const playClient = createPlayClientResolver();
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
    resolveAscApi: function resolveAscApi() {
      return Promise.resolve(storeSession.ascClient);
    },
    resolvePlayApi: storeSession.playClient,
  };
}
