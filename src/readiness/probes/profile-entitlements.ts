import type { AppDescriptor } from '@/types/app.js';
import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { mapEntitlementsToCapabilities } from '@/credentials/capabilities.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

/** An in-scope app: declares a bundle id and at least one entitlement that maps to a portal capability. */
type EntitledApp = {
  name: string;
  identifier: string;
  required: string[];
};

type BundleRecord = Readonly<{ id: string }> | null;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isBundleMissing(bundle: BundleRecord): bundle is null {
  return bundle == null;
}

function hasBundleId(app: AppDescriptor): app is AppDescriptor & { bundleId: string } {
  return app.bundleId != null;
}

function requiredCapabilities(app: AppDescriptor & { bundleId: string }): EntitledApp | null {
  const required = mapEntitlementsToCapabilities(app.iosEntitlements).enable;
  const hasRequired = required.length > 0;

  if (hasRequired == false) {
    return null;
  }

  return { name: app.name, identifier: app.bundleId, required };
}

function readEntitledApp(app: AppDescriptor): EntitledApp | null {
  if (hasBundleId(app)) {
    return requiredCapabilities(app);
  }

  return null;
}

function entitledApps(apps: readonly AppDescriptor[]): EntitledApp[] {
  const entitled: EntitledApp[] = [];

  for (const app of apps) {
    const entitledApp = readEntitledApp(app);

    const isOutsideScope = entitledApp == null;

    if (isOutsideScope) {
      continue;
    }

    entitled.push(entitledApp);
  }

  return entitled;
}

async function readEntitlements(api: AscReadinessApi, app: EntitledApp): Promise<AppReadiness> {
  const bundle = await api.findBundleId(app.identifier);

  if (isBundleMissing(bundle)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - App ID not registered",
      hint: 'run `launch-store setup ios --provision` to register the App ID and its capabilities',
    };
  }

  const capabilities = await api.listBundleIdCapabilities(bundle.id);

  function capabilityType(capability: { capabilityType: string }): string {
    return capability.capabilityType;
  }

  const enabled = new Set(capabilities.map(capabilityType));

  function isMissing(capability: string): boolean {
    return enabled.has(capability) == false;
  }

  const missing = app.required.filter(isMissing);

  const coversEntitlements = missing.length == 0;

  if (coversEntitlements) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'App ID capabilities cover all entitlements',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'blocker',
    detail: `App ID missing capabilities: ${missing.join(', ')}`,
    hint: 'run `launch-store setup ios --provision` to enable them, then regenerate the profile',
  };
}

/** The App Store Connect entitlement capability readiness probe - a signing-readiness check and submit blocker. */
export const profileEntitlementsProbe = {
  id: 'apple-profile-entitlements',
  title: 'App ID capabilities match entitlements',
  store: 'appstore',
  categories: ['signing', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = entitledApps(readinessContext.apps);

    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readCapabilities(app: EntitledApp): Promise<AppReadiness> {
      return readEntitlements(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readCapabilities));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
