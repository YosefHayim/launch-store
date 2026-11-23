import type {
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types/snapshot.ts';
import { iosApps } from '../../readiness/app-scopes.ts';

function readSnapshotEntity(capabilityType: string): SnapshotEntity {
  return { key: capabilityType, summary: `capability ${capabilityType}`, data: { capabilityType } };
}

async function captureApp(api: SnapshotAscApi, app: { name: string; identifier: string }) {
  const bundle = await api.findBundleId(app.identifier);

  if (bundle == null) {
    return { app: app.name, identifier: app.identifier, entities: [] };
  }

  const capabilities = await api.listBundleIdCapabilities(bundle.id);
  const entities = capabilities
    .map(function capabilityEntity(capability) {
      return readSnapshotEntity(capability.capabilityType);
    })
    .sort(function byKey(left, right) {
      return left.key.localeCompare(right.key);
    });

  return { app: app.name, identifier: app.identifier, entities };
}

async function captureAppleCapabilities(snapshotContext: SnapshotContext): Promise<SourceCapture> {
  const apps = iosApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' };
  }

  const api = await snapshotContext.resolveAscApi();

  if (api == null) {
    return {
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch-store creds set-key`',
    };
  }

  const captured = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureApp(api, app);
    }),
  );

  return { state: 'captured', apps: captured };
}

export const appleCapabilitiesSource: SnapshotSource = {
  id: 'apple-capabilities',
  title: 'App ID capabilities',
  store: 'appstore',
  capture: captureAppleCapabilities,
};
