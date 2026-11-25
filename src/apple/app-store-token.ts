// Signs the App Store Connect token from the private key saved for Launch.

import { createPrivateKey, sign } from 'node:crypto';
import type { AscKey } from '../types/credentials.ts';

export function signAppStoreConnectToken(key: AscKey, issuedAt: number): string {
  const tokenLifetimeSeconds = 19 * 60;

  try {
    var privateKey = createPrivateKey(key.p8);
  } catch (error) {
    throw new Error('Could not read the App Store Connect key', { cause: error });
  }

  const serialized = JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' });
  const headerSegment = base64Url(serialized);
  const claimSegment = base64Url(
    JSON.stringify({
      iss: key.issuerId,
      iat: issuedAt,
      exp: issuedAt + tokenLifetimeSeconds,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signingInput = `${headerSegment}.${claimSegment}`;

  try {
    const bufferBytes = Buffer.from(signingInput);
    var signature = sign('sha256', bufferBytes, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
  } catch (error) {
    throw new Error('Could not sign the App Store Connect token', { cause: error });
  }

  return `${signingInput}.${base64Url(signature)}`;
}

function base64Url(bytes: string | Buffer): string {
  const encoded = Buffer.from(bytes).toString('base64url');

  return encoded;
}
