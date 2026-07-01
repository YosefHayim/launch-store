/**
 * Probe: has each iOS app completed its **age-rating questionnaire** on App Store Connect? Apple won't
 * accept a submission until the age-rating declaration exists and is answered — an untouched questionnaire
 * is a hard App Review blocker that's easy to forget because it lives on the version's `appInfo`, not the
 * app record. This surfaces it before submission instead of at rejection.
 *
 * Read-only: it reads the editable version's declaration via the same readers `launch sync` uses and never
 * writes an answer. The declaration hangs off the editable (unpublished) version's `appInfo`, so an app
 * with no editable version or no app record can't be graded — those degrade to a `warn`, not a false
 * blocker. Per-app over the iOS scope; omits itself when no iOS app is in scope.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../../types.js';
import { iosApps } from '../appScopes.js';

/** The App Store Connect age-rating-declaration readiness probe — a listing-completeness and submit blocker. */
export const ageRatingProbe: ReadinessProbe = {
  id: 'apple-age-rating',
  title: 'Age rating completed',
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
        const appInfoId = await api.getEditableAppInfoId(appId);
        if (!appInfoId) {
          return {
            app: name,
            identifier,
            status: 'warn' as const,
            detail: "can't verify — no editable app version",
            hint: 'create a new version in App Store Connect, then re-run',
          };
        }
        const declaration = await api.getAgeRatingDeclaration(appInfoId);
        return declaration && Object.keys(declaration.attributes).length > 0
          ? {
              app: name,
              identifier,
              status: 'ok' as const,
              detail: 'age-rating questionnaire completed',
            }
          : {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'age-rating questionnaire not completed',
              hint: 'answer it in App Store Connect → App Information → Age Rating before submitting',
            };
      }),
    );
    return { state: 'checked', apps: results };
  },
};
