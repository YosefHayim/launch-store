import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

type ReviewDetail = Readonly<{
  attributes: Record<string, string | boolean>;
}> | null;

type EditableVersion = Readonly<{
  id: string;
  copyright: string;
}> | null;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isVersionMissing(version: EditableVersion): version is null {
  return version == null;
}

function isReviewDetailMissing(detail: ReviewDetail): detail is null {
  return detail == null;
}

function hasDemoName(demoName: string | boolean | undefined): boolean {
  if (typeof demoName == 'string') {
    return demoName.length > 0;
  }

  return false;
}

async function readDemoAccount(
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

  const version = await api.findEditableAppStoreVersion(appId, 'IOS');

  if (isVersionMissing(version)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no editable app version",
      hint: 'create a new version in App Store Connect, then re-run',
    };
  }

  const detail = await api.getAppStoreReviewDetail(version.id);

  if (isReviewDetailMissing(detail)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: 'App Review details not set',
      hint: 'fill in App Store Connect -> App Review Information, including a demo account if your app requires sign-in',
    };
  }

  const isRequired = detail.attributes['demoAccountRequired'] == true;

  if (isRequired == false) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'no sign-in required for App Review',
    };
  }

  const demoName = detail.attributes['demoAccountName'];

  const nameIsPresent = hasDemoName(demoName);

  if (nameIsPresent) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'demo account provided for App Review',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'blocker',
    detail: 'sign-in required but no demo account provided',
    hint: 'add demo credentials under App Store Connect -> App Review Information before submitting',
  };
}

/** The App Store Connect demo-account readiness probe - a listing-completeness check and submit blocker. */
export const demoAccountProbe = {
  id: 'apple-demo-account',
  title: 'Demo account provided when sign-in is required',
  store: 'appstore',
  categories: ['listing', 'submit'],
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

    function readReview(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readDemoAccount(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readReview));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
