/**
 * Probe: does the Apple Developer team hold a **valid (unexpired) distribution certificate**? Without one,
 * no `.p12` can be assembled and every distribution archive fails to sign. Unlike the per-app probes this
 * is a *team-level* prerequisite — one certificate covers every app — so it emits a single finding (keyed to
 * the team, not a bundle id) whenever at least one iOS app is in scope. Read-only, via `listDistributionCertificates`.
 *
 * Validity, not mere presence: a certificate with a past `expirationDate` can't sign, so an expired-only set
 * is a blocker just like an empty one. A certificate with no `expirationDate` is treated as usable (the API
 * omits it only for entries it can't date, which we don't want to false-flag).
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../types.js';
import { iosApps } from '../appScopes.js';

/** Synthetic subject for the team-wide finding (this prerequisite isn't scoped to a single app). */
const TEAM_SUBJECT = { app: 'Apple Developer team', identifier: 'team-wide' } as const;

/** Whether a certificate can still sign: no expiry recorded, or an expiry still in the future. */
function isUsable(cert: { expirationDate?: string | undefined }, now: number): boolean {
  if (!cert.expirationDate) return true;
  return new Date(cert.expirationDate).getTime() > now;
}

/** The Apple distribution-certificate validity readiness probe (team-level). */
export const distributionCertProbe: ReadinessProbe = {
  id: 'apple-distribution-cert',
  title: 'Apple distribution certificate valid',
  store: 'appstore',
  categories: ['signing', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    if (iosApps(ctx.apps).length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const certs = await api.listDistributionCertificates();
    const usable = certs.filter((cert) => isUsable(cert, Date.now())).length;

    let finding: AppReadiness;
    if (usable > 0) {
      finding = {
        ...TEAM_SUBJECT,
        status: 'ok',
        detail: `${usable} valid distribution certificate(s)`,
      };
    } else if (certs.length > 0) {
      finding = {
        ...TEAM_SUBJECT,
        status: 'blocker',
        detail: `${certs.length} distribution certificate(s), all expired`,
        hint: "create a fresh distribution certificate (`launch creds`) — distribution archives can't be signed with an expired one",
      };
    } else {
      finding = {
        ...TEAM_SUBJECT,
        status: 'blocker',
        detail: 'no distribution certificate on the account',
        hint: 'create a distribution certificate (`launch creds`) before building for the App Store',
      };
    }
    return { state: 'checked', apps: [finding] };
  },
};
