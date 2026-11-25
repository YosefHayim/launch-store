import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { signAppleToken } from './app-store-connect.js';

describe('signAppleToken', () => {
  it('signs an App Store Connect token', () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const exported = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const isPem = typeof exported === 'string';

    if (!isPem) {
      throw new Error('expected a pem string');
    }

    const token = signAppleToken({ keyId: 'KEYID', issuerId: 'ISSUER', privateKey: exported });
    const parts = token.split('.');

    expect(parts).toHaveLength(3);

    const payloadPart = parts[1];
    const isPayloadMissing = payloadPart == null;

    if (isPayloadMissing) {
      throw new Error('token has no payload');
    }

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      aud: string;
      iss: string;
    };
    const signaturePart = parts[2];
    const isSignatureMissing = signaturePart == null;

    if (isSignatureMissing) {
      throw new Error('token has no signature');
    }

    expect(payload.aud).toBe('appstoreconnect-v1');
    expect(payload.iss).toBe('ISSUER');
    expect(Buffer.from(signaturePart, 'base64url')).toHaveLength(64);
  });
});
