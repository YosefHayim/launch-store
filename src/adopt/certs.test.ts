import { describe, expect, it } from 'vitest';
import type { CertificateResource, ProfileResource } from '../types/apple-catalog.ts';
import { planCertReports } from './certs.ts';

function certificate(overrides: Partial<CertificateResource> = {}): CertificateResource {
  return {
    id: 'c1',
    serialNumber: 'ABC123',
    certificateContent: 'base64',
    ...overrides,
  };
}

function profile(overrides: Partial<ProfileResource> = {}): ProfileResource {
  return {
    id: 'p1',
    name: 'Acme App Store',
    uuid: 'uuid-1',
    profileContent: 'base64',
    ...overrides,
  };
}

function describePlanCertReports() {
  function reportsADelegationHintWhenTheAccountHasNoDistributionCertificate() {
    const writes = planCertReports({
      certificates: [],
      profiles: [],
      local: { certSerial: null, bundleIds: [] },
      bundleId: 'com.acme.app',
    });

    expect(writes).toHaveLength(1);

    const firstWrite = writes[0];

    expect(firstWrite).toBeDefined();

    if (firstWrite == null) return;

    expect(firstWrite.description).toBe('certs: no distribution certificates on this account');
    expect(firstWrite.note).toMatch(/launch-store creds setup/);
    expect(firstWrite.change).toEqual({ home: 'keychain' });
  }

  it(
    'reports a delegation hint when the account has no distribution certificate',
    reportsADelegationHintWhenTheAccountHasNoDistributionCertificate,
  );

  function confirmsACertificateWhosePrivateKeyIsInThisKeychainWithNoDelegationNote() {
    const writes = planCertReports({
      certificates: [
        certificate({ serialNumber: 'ABC123', expirationDate: '2027-01-02T00:00:00Z' }),
      ],
      profiles: [],
      local: { certSerial: 'ABC123', bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    const firstWrite = writes[0];

    expect(firstWrite).toBeDefined();

    if (firstWrite == null) return;

    expect(firstWrite.description).toBe(
      'certs: distribution certificate ABC123 (expires 2027-01-02) - private key present in this keychain',
    );
    expect(firstWrite.note).toBeUndefined();
  }

  it(
    'confirms a certificate whose private key is in this keychain, with no delegation note',
    confirmsACertificateWhosePrivateKeyIsInThisKeychainWithNoDelegationNote,
  );

  function flagsACertificateWhoseKeyIsAbsentLocallyAndDelegatesToCredsSetup() {
    const writes = planCertReports({
      certificates: [certificate({ serialNumber: 'ZZZ999' })],
      profiles: [],
      local: { certSerial: 'ABC123', bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    const firstWrite = writes[0];

    expect(firstWrite).toBeDefined();

    if (firstWrite == null) return;

    expect(firstWrite.description).toContain('private key not in this keychain');
    expect(firstWrite.note).toMatch(/never returns the private key/);
  }

  it(
    'flags a certificate whose key is absent locally and delegates to creds setup',
    flagsACertificateWhoseKeyIsAbsentLocallyAndDelegatesToCredsSetup,
  );

  function reportsAProfileSLocalInstallVerdictForTheAdoptedBundleId() {
    const installed = planCertReports({
      certificates: [],
      profiles: [profile()],
      local: { certSerial: null, bundleIds: ['com.acme.app'] },
      bundleId: 'com.acme.app',
    });
    const installedWrite = installed.at(-1);

    expect(installedWrite).toBeDefined();

    if (installedWrite == null) return;

    expect(installedWrite.description).toBe(
      'certs: profile "Acme App Store" (uuid-1) - installed locally',
    );
    expect(installedWrite.note).toBeUndefined();

    const missing = planCertReports({
      certificates: [],
      profiles: [profile()],
      local: { certSerial: null, bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    const missingWrite = missing.at(-1);

    expect(missingWrite).toBeDefined();

    if (missingWrite == null) return;

    expect(missingWrite.description).toContain('not installed locally');
    expect(missingWrite.note).toMatch(/launch-store creds setup/);
  }

  it(
    "reports a profile's local-install verdict for the adopted bundle id",
    reportsAProfileSLocalInstallVerdictForTheAdoptedBundleId,
  );
}

describe('planCertReports', describePlanCertReports);
