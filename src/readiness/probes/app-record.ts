// Checks that each iOS app already has a record in App Store Connect.

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import type { AscReadinessApi } from '@/types/readiness.js';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

async function readAppRecord(
  api: AscReadinessApi,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const appId = await api.getAppId(app.identifier);

  if (isAppRecordMissing(appId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: 'no app record on App Store Connect',
      hint: "create the app once in App Store Connect - Apple's API can't (no POST /v1/apps)",
    };
  }

  return { app: app.name, identifier: app.identifier, status: 'ok', detail: 'record exists' };
}

export const appRecordProbe = {
  id: 'apple-app-record',
  title: 'App Store Connect app record',
  store: 'appstore',
  categories: ['account', 'submit'],
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

    function readRecord(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readAppRecord(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readRecord));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
