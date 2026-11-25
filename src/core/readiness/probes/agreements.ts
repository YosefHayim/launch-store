import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** Synthetic subject for the account-wide finding (agreements aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;
/** The Apple required-agreements (incl. banking & tax) readiness probe - an account-onboarding and submit blocker. */
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
      if (iosApps(readinessContext.apps).length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
      const signed = yield* api.checkRequiredAgreements();
      let finding: AppReadiness = {
        ...ACCOUNT_SUBJECT,
        status: 'blocker',
        detail:
          'a required agreement is unsigned or expired (developer, paid-apps, or banking/tax)',
        hint: 'sign it in App Store Connect -> Business -> Agreements, Tax, and Banking - until then every upload returns 403',
      };
      if (signed) {
        finding = {
          ...ACCOUNT_SUBJECT,
          status: 'ok',
          detail: 'required agreements signed and in effect',
        };
      }
      return { state: 'checked', apps: [finding] };
    });
  },
} satisfies ReadinessProbe;
