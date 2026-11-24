// Reports whether App Store Connect certificates and profiles match the local keychain.

import { describeStoredCredentials } from '../credentials/apple-signing-assets.ts';
import type { Adopter, PlannedWrite } from '../types/adopt.ts';
import type { CertificateResource, ProfileResource } from '../types/apple/provisioning.ts';

type LocalSigningView = Readonly<{
  certSerial: string | null;
  bundleIds: readonly string[];
}>;

type CertPlanInput = Readonly<{
  certificates: readonly CertificateResource[];
  profiles: readonly ProfileResource[];
  local: LocalSigningView;
  bundleId: string;
}>;

const DELEGATE_HINT =
  'Apple never returns the private key - run `launch-store creds setup` to issue or reuse a usable certificate and profile';

/** Build one detect-only signing report. */
function signingReport(description: string, note: string | undefined): PlannedWrite {
  if (note != null) {
    return {
      description,
      fidelity: 'detect',
      note,
      change: { home: 'keychain' },
    };
  }

  return {
    description,
    fidelity: 'detect',
    change: { home: 'keychain' },
  };
}

/** Compare live signing assets against the locally cached private-key view. */
export function planCertReports(certPlan: CertPlanInput): PlannedWrite[] {
  const plannedWrites: PlannedWrite[] = [];

  if (certPlan.certificates.length == 0) {
    plannedWrites.push(
      signingReport('certs: no distribution certificates on this account', DELEGATE_HINT),
    );
  }

  for (const certificate of certPlan.certificates) {
    const keyAvailableLocally = certificate.serialNumber == certPlan.local.certSerial;
    let expiryDescription = '';

    if (certificate.expirationDate != null) {
      expiryDescription = ` (expires ${certificate.expirationDate.slice(0, 10)})`;
    }

    let keyVerdict = 'private key not in this keychain';

    if (keyAvailableLocally) {
      keyVerdict = 'private key present in this keychain';
    }

    let note: string | undefined = DELEGATE_HINT;

    if (keyAvailableLocally) {
      note = undefined;
    }

    plannedWrites.push(
      signingReport(
        `certs: distribution certificate ${certificate.serialNumber}${expiryDescription} - ${keyVerdict}`,
        note,
      ),
    );
  }

  const profileInstalled = certPlan.local.bundleIds.includes(certPlan.bundleId);

  for (const profile of certPlan.profiles) {
    let profileVerdict = 'not installed locally';

    if (profileInstalled) {
      profileVerdict = 'installed locally';
    }

    let note: string | undefined = DELEGATE_HINT;

    if (profileInstalled) {
      note = undefined;
    }

    plannedWrites.push(
      signingReport(`certs: profile "${profile.name}" (${profile.uuid}) - ${profileVerdict}`, note),
    );
  }

  return plannedWrites;
}

/** Read live and local signing assets and plan detect-only reports. */
export const certsAdopter: Adopter = {
  domain: 'certs',
  fidelity: 'detect',
  async read(appleCatalog, target) {
    const bundleResource = await appleCatalog.findBundleId(target.bundleId);
    const certificates = await appleCatalog.listDistributionCertificates();
    let profiles: readonly ProfileResource[] = [];

    if (bundleResource != null) {
      profiles = await appleCatalog.listProfilesForBundleId(bundleResource.id);
    }

    const storedCredentials = await describeStoredCredentials(target.keyId);

    return planCertReports({
      certificates,
      profiles,
      local: {
        certSerial: storedCredentials.certSerial,
        bundleIds: storedCredentials.bundleIds,
      },
      bundleId: target.bundleId,
    });
  },
};
