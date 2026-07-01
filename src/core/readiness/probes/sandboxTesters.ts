/**
 * Probe: does the Apple account have at least one **sandbox tester** for any app that sells in-app
 * purchases or subscriptions? A sandbox tester is the fake Apple ID you sign into on-device to exercise a
 * real StoreKit purchase before release — without one, there's no way to confirm the buy flow actually
 * works, so a broken purchase ships undetected. This is advisory (a `warn`, never a submit blocker): Apple
 * doesn't require a tester to *submit*, but shipping IAP you've never test-purchased is the classic gap.
 *
 * Sandbox testers are an account-wide resource (not scoped to an app, and Apple exposes no API to create
 * one), so — like the agreements and distribution-cert probes — this emits a single account-level finding,
 * and only when some app is actually selling something. Tagged `iap` only.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../../types.js';
import { iosApps } from '../appScopes.js';
import { sellsProducts } from './iapReadiness.js';

/** Synthetic subject for the account-wide finding (sandbox testers aren't scoped to a single app). */
const ACCOUNT_SUBJECT = { app: 'Apple account', identifier: 'account-wide' } as const;

/** The App Store Connect sandbox-tester readiness probe — advisory IAP testing prerequisite. */
export const sandboxTestersProbe: ReadinessProbe = {
  id: 'apple-sandbox-testers',
  title: 'Sandbox testers for StoreKit testing',
  store: 'appstore',
  categories: ['iap'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const sellsAnything = iosApps(ctx.apps).some(({ identifier }) =>
      sellsProducts(ctx, identifier),
    );
    if (!sellsAnything) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const testers = await api.listSandboxTesters();
    const finding: AppReadiness =
      testers.length > 0
        ? {
            ...ACCOUNT_SUBJECT,
            status: 'ok',
            detail: `${testers.length} sandbox tester(s) configured`,
          }
        : {
            ...ACCOUNT_SUBJECT,
            status: 'warn',
            detail: "no sandbox testers — StoreKit purchases can't be test-bought before release",
            hint: 'add one in App Store Connect → Users and Access → Sandbox → Testers',
          };
    return { state: 'checked', apps: [finding] };
  },
};
