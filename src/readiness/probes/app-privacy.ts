// Checks that App Privacy is published in App Store Connect before the first submission.

import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { hasReleasedVersion } from '../../release/app-store-release.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

async function readAppPrivacy(
  api: AscReadinessApi,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const appId = await api.getAppId(app.identifier);

  if (isAppRecordMissing(appId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no app record yet",
      hint: 'create the app record first (see the app-record check)',
    };
  }

  const storeVersions = await api.listAppStoreVersions(appId, 'IOS');

  const wasReleased = hasReleasedVersion(storeVersions);

  if (wasReleased) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'released before - App Privacy carries over to new versions',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'warn',
    detail: "first version - App Privacy must be published by hand (Apple's API can't read it)",
    hint: 'publish the answers in App Store Connect -> App Privacy before submitting; Apple refuses the first submission until then',
  };
}

/** The App Privacy readiness probe. */
export const appPrivacyProbe = {
  id: 'apple-app-privacy',
  title: 'App Privacy published',
  store: 'appstore',
  categories: ['privacy', 'submit'],
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

    function readPrivacy(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readAppPrivacy(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readPrivacy));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
