import { describe, expect, it } from 'vitest';
import type { CertificateResource, ProfileResource } from '../types/appleCatalog.js';
import { planCertReports } from './certs.js';

const certificate = (overrides: Partial<CertificateResource> = {}): CertificateResource => ({
  id: 'c1',
  serialNumber: 'ABC123',
  certificateContent: 'base64',
  ...overrides,
});

const profile = (overrides: Partial<ProfileResource> = {}): ProfileResource => ({
  id: 'p1',
  name: 'Acme App Store',
  uuid: 'uuid-1',
  profileContent: 'base64',
  ...overrides,
});

describe('planCertReports', () => {
  it('reports a delegation hint when the account has no distribution certificate', () => {
    const writes = planCertReports({
      certificates: [],
      profiles: [],
      local: { certSerial: null, bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    expect(writes).toHaveLength(1);
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.description).toBe('certs: no distribution certificates on this account');
    expect(firstWrite.note).toMatch(/launch creds setup/);
    expect(firstWrite.change).toEqual({ home: 'keychain' });
  });

  it('confirms a certificate whose private key is in this keychain, with no delegation note', () => {
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
    if (firstWrite === undefined) return;
    expect(firstWrite.description).toBe(
      'certs: distribution certificate ABC123 (expires 2027-01-02) - private key present in this keychain',
    );
    expect(firstWrite.note).toBeUndefined();
  });

  it('flags a certificate whose key is absent locally and delegates to creds setup', () => {
    const writes = planCertReports({
      certificates: [certificate({ serialNumber: 'ZZZ999' })],
      profiles: [],
      local: { certSerial: 'ABC123', bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    const firstWrite = writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(firstWrite.description).toContain('private key not in this keychain');
    expect(firstWrite.note).toMatch(/never returns the private key/);
  });

  it("reports a profile's local-install verdict for the adopted bundle id", () => {
    const installed = planCertReports({
      certificates: [],
      profiles: [profile()],
      local: { certSerial: null, bundleIds: ['com.acme.app'] },
      bundleId: 'com.acme.app',
    });
    const installedWrite = installed.at(-1);
    expect(installedWrite).toBeDefined();
    if (installedWrite === undefined) return;
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
    if (missingWrite === undefined) return;
    expect(missingWrite.description).toContain('not installed locally');
    expect(missingWrite.note).toMatch(/launch creds setup/);
  });
});
