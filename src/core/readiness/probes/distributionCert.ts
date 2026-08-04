import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { iosApps } from '../appScopes.js';
/** Synthetic subject for the team-wide finding (this prerequisite isn't scoped to a single app). */
const TEAM_SUBJECT = { app: 'Apple Developer team', identifier: 'team-wide' } as const;
const isUsable = (
  cert: {
    expirationDate?: string | undefined;
  },
  now: number,
): boolean => {
  if (!cert.expirationDate) return true;
  return new Date(cert.expirationDate).getTime() > now;
};
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
      const api = yield* readinessContext.resolveAscApi();
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      const certificates = yield* api.listDistributionCertificates();
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
          hint: "create a fresh distribution certificate (`launch creds`) - distribution archives can't be signed with an expired one",
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
