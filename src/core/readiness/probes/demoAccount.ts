/**
 * Probe: if an iOS app requires sign-in to use, has it given App Review a **demo account**? When a build's
 * App Review details set `demoAccountRequired`, Apple's reviewer needs working credentials to get past the
 * login wall — a build that demands sign-in without a demo account name is rejected on first contact
 * (Guideline 2.1). The probe surfaces that gap before submission instead of after a multi-day round-trip.
 *
 * Read-only: it reads the editable version's App Review detail via the same readers `launch sync` uses and
 * never writes one. The demo password is write-only on Apple's side and never returned, so the probe grades
 * only the readable `demoAccountRequired` / `demoAccountName` pair. An app with no record, no editable
 * version, or no App Review detail yet can't be graded — those degrade to a `warn`, not a false blocker.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../types.js';
import { iosApps } from '../appScopes.js';

/** The App Store Connect demo-account readiness probe — a listing-completeness check and submit blocker. */
export const demoAccountProbe: ReadinessProbe = {
  id: 'apple-demo-account',
  title: 'Demo account provided when sign-in is required',
  store: 'appstore',
  categories: ['listing', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const results: AppReadiness[] = await Promise.all(
      apps.map(async ({ name, identifier }) => {
        const appId = await api.getAppId(identifier);
        if (!appId) {
          return {
            app: name,
            identifier,
            status: 'warn' as const,
            detail: "can't verify — no app record yet",
            hint: 'create the app record first (see the app-record check)',
          };
        }
        const version = await api.findEditableAppStoreVersion(appId, 'IOS');
        if (!version) {
          return {
            app: name,
            identifier,
            status: 'warn' as const,
            detail: "can't verify — no editable app version",
            hint: 'create a new version in App Store Connect, then re-run',
          };
        }
        const detail = await api.getAppStoreReviewDetail(version.id);
        if (!detail) {
          return {
            app: name,
            identifier,
            status: 'warn' as const,
            detail: 'App Review details not set',
            hint: 'fill in App Store Connect → App Review Information, including a demo account if your app requires sign-in',
          };
        }
        const required = detail.attributes['demoAccountRequired'] === true;
        const demoName = detail.attributes['demoAccountName'];
        const hasName = typeof demoName === 'string' && demoName.length > 0;
        if (!required) {
          return {
            app: name,
            identifier,
            status: 'ok' as const,
            detail: 'no sign-in required for App Review',
          };
        }
        return hasName
          ? {
              app: name,
              identifier,
              status: 'ok' as const,
              detail: 'demo account provided for App Review',
            }
          : {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'sign-in required but no demo account provided',
              hint: 'add demo credentials under App Store Connect → App Review Information before submitting',
            };
      }),
    );
    return { state: 'checked', apps: results };
  },
};
