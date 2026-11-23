import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

/** Synthetic subject for the account-wide finding (agreements aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function signedFinding(): AppReadiness {
  return {
    ...ACCOUNT_SUBJECT,
    status: 'ok',
    detail: 'required agreements signed and in effect',
  };
}

function unsignedFinding(): AppReadiness {
  return {
    ...ACCOUNT_SUBJECT,
    status: 'blocker',
    detail: 'a required agreement is unsigned or expired (developer, paid-apps, or banking/tax)',
    hint: 'sign it in App Store Connect -> Business -> Agreements, Tax, and Banking - until then every upload returns 403',
  };
}

/** The Apple required-agreements (incl. banking & tax) readiness probe - an account-onboarding and submit blocker. */
export const agreementsProbe = {
  id: 'apple-agreements',
  title: 'Apple agreements, banking & tax',
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

    const signed = await api.checkRequiredAgreements();

    const isSigned = signed == true;

    if (isSigned) {
      return { state: 'checked', apps: [signedFinding()] };
    }

    return { state: 'checked', apps: [unsignedFinding()] };
  },
} satisfies ReadinessProbe;
