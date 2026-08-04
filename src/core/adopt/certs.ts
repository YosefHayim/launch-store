import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { describeStoredCredentials } from '../credentials/appleSigning.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { Adopter, PlannedWrite } from '../types/adopt.js';
import type { CertificateResource, ProfileResource } from '../types/appleCatalog.js';

export type LocalSigningView = {
  certSerial: string | null;
  bundleIds: string[];
};

export type CertPlanInput = {
  certificates: readonly CertificateResource[];
  profiles: readonly ProfileResource[];
  local: LocalSigningView;
  bundleId: string;
};

type CertAdopterRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

const DELEGATE_HINT =
  'Apple never returns the private key - run `launch creds setup` to issue or reuse a usable certificate and profile';

/** Build one detect-only signing report. */
const signingReport = (description: string, note?: string): PlannedWrite => {
  const plannedWrite: PlannedWrite = {
    description,
    fidelity: 'detect',
    change: { home: 'keychain' },
  };
  if (note === undefined) return plannedWrite;
  return { ...plannedWrite, note };
};

/** Compare live signing assets against the locally cached private-key view. */
export const planCertReports = (input: CertPlanInput): PlannedWrite[] => {
  const plannedWrites: PlannedWrite[] = [];
  if (input.certificates.length === 0) {
    plannedWrites.push(
      signingReport('certs: no distribution certificates on this account', DELEGATE_HINT),
    );
  }
  for (const certificate of input.certificates) {
    const keyAvailableLocally = certificate.serialNumber === input.local.certSerial;
    let expiryDescription = '';
    if (certificate.expirationDate !== undefined)
      expiryDescription = ` (expires ${certificate.expirationDate.slice(0, 10)})`;
    let keyVerdict = 'private key not in this keychain';
    if (keyAvailableLocally) keyVerdict = 'private key present in this keychain';
    let note: string | undefined = DELEGATE_HINT;
    if (keyAvailableLocally) note = undefined;
    plannedWrites.push(
      signingReport(
        `certs: distribution certificate ${certificate.serialNumber}${expiryDescription} - ${keyVerdict}`,
        note,
      ),
    );
  }
  const profileInstalled = input.local.bundleIds.includes(input.bundleId);
  for (const profile of input.profiles) {
    let profileVerdict = 'not installed locally';
    if (profileInstalled) profileVerdict = 'installed locally';
    let note: string | undefined = DELEGATE_HINT;
    if (profileInstalled) note = undefined;
    plannedWrites.push(
      signingReport(`certs: profile "${profile.name}" (${profile.uuid}) - ${profileVerdict}`, note),
    );
  }
  return plannedWrites;
};

/** Read live and local signing assets and plan detect-only reports. */
export const certsAdopter: Adopter<CertAdopterRequirements> = {
  domain: 'certs',
  fidelity: 'detect',
  read: (appleCatalog, target) =>
    Effect.gen(function* () {
      const bundleResource = yield* appleCatalog.findBundleId(target.bundleId);
      const certificates = yield* appleCatalog.listDistributionCertificates();
      let profiles: readonly ProfileResource[] = [];
      if (bundleResource !== null)
        profiles = yield* appleCatalog.listProfilesForBundleId(bundleResource.id);
      const storedCredentials = yield* describeStoredCredentials(target.keyId);
      return planCertReports({
        certificates,
        profiles,
        local: {
          certSerial: storedCredentials.certSerial,
          bundleIds: storedCredentials.bundleIds,
        },
        bundleId: target.bundleId,
      });
    }),
};
