import { describe, expect, it } from 'vitest';
import { planCertReports } from './certs.js';
import type { CertificateResource, ProfileResource } from '../../apple/ascClient.js';

const CERT = (overrides: Partial<CertificateResource> = {}): CertificateResource => ({
  id: 'c1',
  serialNumber: 'ABC123',
  certificateContent: 'base64',
  ...overrides,
});

const PROFILE = (overrides: Partial<ProfileResource> = {}): ProfileResource => ({
  id: 'p1',
  name: 'Acme App Store',
  uuid: 'uuid-1',
  profileContent: 'base64',
  ...overrides,
});

describe('planCertReports', () => {
  it('reports a delegation hint when the account has no distribution certificate', () => {
    const writes = planCertReports({
      certs: [],
      profiles: [],
      local: { certSerial: null, bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.description).toBe('certs: no distribution certificates on this account');
    expect(writes[0]?.note).toMatch(/launch creds setup/);
    expect(writes[0]?.change).toEqual({ home: 'keychain' });
  });

  it('confirms a certificate whose private key is in this keychain, with no delegation note', () => {
    const writes = planCertReports({
      certs: [CERT({ serialNumber: 'ABC123', expirationDate: '2027-01-02T00:00:00Z' })],
      profiles: [],
      local: { certSerial: 'ABC123', bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    expect(writes[0]?.description).toBe(
      'certs: distribution certificate ABC123 (expires 2027-01-02) — private key present in this keychain',
    );
    expect(writes[0]?.note).toBeUndefined();
  });

  it('flags a certificate whose key is absent locally and delegates to creds setup', () => {
    const writes = planCertReports({
      certs: [CERT({ serialNumber: 'ZZZ999' })],
      profiles: [],
      local: { certSerial: 'ABC123', bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    expect(writes[0]?.description).toContain('private key not in this keychain');
    expect(writes[0]?.note).toMatch(/never returns the private key/);
  });

  it("reports a profile's local-install verdict for the adopted bundle id", () => {
    const installed = planCertReports({
      certs: [],
      profiles: [PROFILE()],
      local: { certSerial: null, bundleIds: ['com.acme.app'] },
      bundleId: 'com.acme.app',
    });
    expect(installed.at(-1)?.description).toBe(
      'certs: profile "Acme App Store" (uuid-1) — installed locally',
    );
    expect(installed.at(-1)?.note).toBeUndefined();

    const missing = planCertReports({
      certs: [],
      profiles: [PROFILE()],
      local: { certSerial: null, bundleIds: [] },
      bundleId: 'com.acme.app',
    });
    expect(missing.at(-1)?.description).toContain('not installed locally');
    expect(missing.at(-1)?.note).toMatch(/launch creds setup/);
  });
});
