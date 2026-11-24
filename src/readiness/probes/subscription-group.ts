// Checks that each declared subscription group exists on App Store Connect.

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

function declaredGroupCount(readinessContext: ReadinessContext, bundleId: string): number {
  const groupCount = readinessContext.config.products?.[bundleId]?.subscriptionGroups?.length;

  const isUndeclared = groupCount == null;

  if (isUndeclared) {
    return 0;
  }

  return groupCount;
}

function declaresSubscriptionGroups(readinessContext: ReadinessContext, bundleId: string): boolean {
  return declaredGroupCount(readinessContext, bundleId) > 0;
}

async function readSubscriptionGroups(
  api: AscReadinessApi,
  readinessContext: ReadinessContext,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const declared = declaredGroupCount(readinessContext, app.identifier);
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

  const groups = await api.listSubscriptionGroups(appId);

  const hasGroups = groups.length > 0;

  if (hasGroups) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: `${groups.length} group(s) present`,
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'blocker',
    detail: `config declares ${declared} subscription group(s), none exist on App Store Connect`,
    hint: 'run `launch-store sync` to create the declared subscription group(s)',
  };
}

/** The App Store Connect subscription-group readiness probe. */
export const subscriptionGroupProbe = {
  id: 'apple-subscription-group',
  title: 'Subscription group ready',
  store: 'appstore',
  categories: ['account', 'iap'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function keepsSellingApp(app: { identifier: string }): boolean {
      return declaresSubscriptionGroups(readinessContext, app.identifier);
    }

    const apps = iosApps(readinessContext.apps).filter(keepsSellingApp);

    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.readAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readGroups(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readSubscriptionGroups(appleApi, readinessContext, app);
    }

    const findings = await Promise.all(apps.map(readGroups));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
