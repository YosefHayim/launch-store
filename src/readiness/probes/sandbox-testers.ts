import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { iosApps } from '../app-scopes.ts';
import { sellsProducts } from './iap-readiness.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

/** Synthetic subject for the account-wide finding (sandbox testers aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function testerFinding(testerCount: number): AppReadiness {
  const hasTesters = testerCount > 0;

  if (hasTesters) {
    return {
      ...ACCOUNT_SUBJECT,
      status: 'ok',
      detail: `${testerCount} sandbox tester(s) configured`,
    };
  }

  return {
    ...ACCOUNT_SUBJECT,
    status: 'warn',
    detail: "no sandbox testers - StoreKit purchases can't be test-bought before release",
    hint: 'add one in App Store Connect -> Users and Access -> Sandbox -> Testers',
  };
}

/** The App Store Connect sandbox-tester readiness probe - advisory IAP testing prerequisite. */
export const sandboxTestersProbe = {
  id: 'apple-sandbox-testers',
  title: 'Sandbox testers for StoreKit testing',
  store: 'appstore',
  categories: ['iap'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function sellsAnything(app: { identifier: string }): boolean {
      return sellsProducts(readinessContext, app.identifier);
    }

    const hasProductApp = iosApps(readinessContext.apps).some(sellsAnything);

    if (hasProductApp == false) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const testers = await api.listSandboxTesters();

    return { state: 'checked', apps: [testerFinding(testers.length)] };
  },
} satisfies ReadinessProbe;
