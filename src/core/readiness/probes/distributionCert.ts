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

import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';

/** Synthetic subject for the team-wide finding (this prerequisite isn't scoped to a single app). */
const TEAM_SUBJECT = { app: 'Apple Developer team', identifier: 'team-wide' } as const;

/**
 * Check whether a certificate can still sign.
 *
 * @param cert - Distribution certificate resource with an optional expiration timestamp.
 * @param now - Current epoch milliseconds used to grade expiry.
 * @returns True when no expiry is recorded or the certificate expires in the future.
 */
function isUsable(cert: { expirationDate?: string | undefined }, now: number): boolean {
  if (!cert.expirationDate) return true;
  return new Date(cert.expirationDate).getTime() > now;
}

/** The Apple distribution-certificate validity readiness probe (team-level). */
export const distributionCertProbe = {
  id: 'apple-distribution-cert',
  title: 'Apple distribution certificate valid',
  store: 'appstore',
  categories: ['signing', 'submit'],
  /**
   * Verify that the Apple Developer team has at least one usable distribution certificate.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with the team-wide distribution-certificate finding.
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

      const certificates = yield* Effect.tryPromise({
        try: () => api.listDistributionCertificates(),
        catch: (apiFailure) => apiFailure,
      });
      const now = yield* Effect.sync(() => Date.now());
      const usable = certificates.filter((certificate) => isUsable(certificate, now)).length;

      let finding: AppReadiness;
      if (usable > 0) {
        finding = {
          ...TEAM_SUBJECT,
          status: 'ok',
          detail: `${usable} valid distribution certificate(s)`,
        };
      } else if (certificates.length > 0) {
        finding = {
          ...TEAM_SUBJECT,
          status: 'blocker',
          detail: `${certificates.length} distribution certificate(s), all expired`,
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
    });
  },
} satisfies ReadinessProbe;
