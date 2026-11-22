import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isAppInfoMissing(appInfoId: string | null): appInfoId is null {
  return appInfoId == null;
}

function hasDeletionUrl(entry: { url: string }): boolean {
  return entry.url.length > 0;
}

async function readAccountDeletion(
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

  const appInfoId = await api.getEditableAppInfoId(appId);

  if (isAppInfoMissing(appInfoId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no editable app version",
      hint: 'create a new version in App Store Connect, then re-run',
    };
  }

  const urls = await api.listAccountDeletionUrls(appInfoId);
  const declared = urls.filter(hasDeletionUrl);
  const hasDeclaredUrl = declared.length > 0;

  if (hasDeclaredUrl) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: `account-deletion URL set in ${declared.length} locale(s)`,
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'warn',
    detail: 'no account-deletion URL set',
    hint: 'Apple requires it if your app lets users create an account - add it under App Store Connect -> App Privacy -> Account Deletion',
  };
}

/** The App Store Connect account-deletion-URL readiness probe - a listing-completeness, conditionally-submit check. */
export const accountDeletionProbe = {
  id: 'apple-account-deletion',
  title: 'Account-deletion URL declared',
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

    function readDeletion(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readAccountDeletion(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readDeletion));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
