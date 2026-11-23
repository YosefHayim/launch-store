// Checks that the team's Apple distribution certificate is still valid.

import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

/** Synthetic subject for the team-wide finding (this prerequisite isn't scoped to a single app). */
const TEAM_SUBJECT = { app: 'Apple Developer team', identifier: 'team-wide' } as const;

type DistributionCertificate = Readonly<{
  expirationDate?: string | undefined;
}>;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isExpirationMissing(expirationDate: string | undefined): expirationDate is undefined {
  return expirationDate == null;
}

function isCertificateUsable(
  certificate: DistributionCertificate,
  nowMilliseconds: number,
): boolean {
  const expirationDate = certificate.expirationDate;

  if (isExpirationMissing(expirationDate)) {
    return true;
  }

  return new Date(expirationDate).getTime() > nowMilliseconds;
}

function gradeCertificates(usableCount: number, certificateCount: number): AppReadiness {
  const hasUsableCertificate = usableCount > 0;

  if (hasUsableCertificate) {
    return {
      ...TEAM_SUBJECT,
      status: 'ok',
      detail: `${usableCount} valid distribution certificate(s)`,
    };
  }

  const hasExpiredCertificates = certificateCount > 0;

  if (hasExpiredCertificates) {
    return {
      ...TEAM_SUBJECT,
      status: 'blocker',
      detail: `${certificateCount} distribution certificate(s), all expired`,
      hint: "create a fresh distribution certificate (`launch-store creds`) - distribution archives can't be signed with an expired one",
    };
  }

  return {
    ...TEAM_SUBJECT,
    status: 'blocker',
    detail: 'no distribution certificate on the account',
    hint: 'create a distribution certificate (`launch-store creds`) before building for the App Store',
  };
}

/** The Apple distribution-certificate validity readiness probe (team-level). */
export const distributionCertProbe = {
  id: 'apple-distribution-cert',
  title: 'Apple distribution certificate valid',
  store: 'appstore',
  categories: ['signing', 'submit'],
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

    const certificates = await api.listDistributionCertificates();
    const nowMilliseconds = Date.now();

    function keepUsable(certificate: DistributionCertificate): boolean {
      return isCertificateUsable(certificate, nowMilliseconds);
    }

    const usableCount = certificates.filter(keepUsable).length;

    return { state: 'checked', apps: [gradeCertificates(usableCount, certificates.length)] };
  },
} satisfies ReadinessProbe;
