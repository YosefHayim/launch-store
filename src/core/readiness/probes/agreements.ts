/**
 * Probe: are the Apple account's **required legal agreements** signed and in effect? An unsigned or
 * expired Apple Developer Program License Agreement, Paid Applications Agreement, or its banking/tax forms
 * makes *every* signing/upload call 403 deep in the pipeline — a cryptic mid-build failure that this turns
 * into one actionable line up front.
 *
 * App Store Connect exposes no agreements-status endpoint, so {@link AscReadinessApi.checkRequiredAgreements}
 * reads the one real signal: any authenticated call returns 403 `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`
 * when an agreement (or its banking/tax info) needs attention. That single error covers the developer
 * agreement *and* the banking/tax case — Apple's API can't distinguish them — so this is one account-level
 * probe rather than two that would make the same call and report the same result. Like the distribution-cert
 * probe, it's a team/account-wide prerequisite (one finding, not per-app) and runs whenever an iOS app is in scope.
 */

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** Synthetic subject for the account-wide finding (agreements aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;

/** The Apple required-agreements (incl. banking & tax) readiness probe — an account-onboarding and submit blocker. */
export const agreementsProbe = {
  id: 'apple-agreements',
  title: 'Apple agreements, banking & tax',
  store: 'appstore',
  categories: ['account', 'submit'],
  /**
   * Read the Apple account agreement status for the selected iOS apps.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with the account-wide agreements finding.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      if (iosApps(readinessContext.apps).length === 0) return { state: 'omitted' };

      const api = yield* Effect.tryPromise({
        try: () => readinessContext.resolveAscApi(),
        catch: (resolverFailure) => resolverFailure,
      });
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };

      const signed = yield* Effect.tryPromise({
        try: () => api.checkRequiredAgreements(),
        catch: (apiFailure) => apiFailure,
      });
      const finding: AppReadiness = signed
        ? { ...ACCOUNT_SUBJECT, status: 'ok', detail: 'required agreements signed and in effect' }
        : {
            ...ACCOUNT_SUBJECT,
            status: 'blocker',
            detail:
              'a required agreement is unsigned or expired (developer, paid-apps, or banking/tax)',
            hint: 'sign it in App Store Connect → Business → Agreements, Tax, and Banking — until then every upload returns 403',
          };
      return { state: 'checked', apps: [finding] };
    });
  },
} satisfies ReadinessProbe;
