import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isBundleUnregistered(bundle: Readonly<{ id: string }> | null): bundle is null {
  return bundle == null;
}

async function readBundleRegistration(
  api: AscReadinessApi,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const bundle = await api.findBundleId(app.identifier);

  if (isBundleUnregistered(bundle)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: 'Bundle ID not registered in the Developer portal',
      hint: 'run `launch sync` to register the App ID before building for distribution',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'ok',
    detail: 'registered in the Developer portal',
  };
}

/** The Apple Bundle ID (App ID) registration readiness probe. */
export const bundleIdProbe = {
  id: 'apple-bundle-id',
  title: 'Apple Bundle ID registered',
  store: 'appstore',
  categories: ['signing', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(readinessContext.apps);
    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readBundle(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readBundleRegistration(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readBundle));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
