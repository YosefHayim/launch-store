import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
import { sellsProducts } from './iapReadiness.js';
/** Synthetic subject for the account-wide finding (sandbox testers aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;
/** The App Store Connect sandbox-tester readiness probe - advisory IAP testing prerequisite. */
export const sandboxTestersProbe = {
  id: 'apple-sandbox-testers',
  title: 'Sandbox testers for StoreKit testing',
  store: 'appstore',
  categories: ['iap'],
  /**
   * Verify that the Apple account has at least one sandbox tester when selected apps sell products.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with the account-wide sandbox-tester finding.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const sellsAnything = iosApps(readinessContext.apps).some(({ identifier }) =>
        sellsProducts(readinessContext, identifier),
      );
      if (!sellsAnything) return { state: 'omitted' };
      const api = yield* readinessContext.resolveAscApi();
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      const testers = yield* api.listSandboxTesters();
      let finding: AppReadiness = {
        ...ACCOUNT_SUBJECT,
        status: 'warn',
        detail: "no sandbox testers - StoreKit purchases can't be test-bought before release",
        hint: 'add one in App Store Connect -> Users and Access -> Sandbox -> Testers',
      };
      if (testers.length > 0) {
        finding = {
          ...ACCOUNT_SUBJECT,
          status: 'ok',
          detail: `${testers.length} sandbox tester(s) configured`,
        };
      }
      return { state: 'checked', apps: [finding] };
    });
  },
} satisfies ReadinessProbe;
