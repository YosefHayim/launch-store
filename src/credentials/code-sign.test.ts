import { describe, expect, it } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { expectArrayElement, expectDefined } from '../testkit/assertions-testkit.ts';
import { signatureHeader } from './code-sign.ts';
function describeSignatureHeader() {
  function producesAnExpoSignatureHeaderWhoseRSASHA256SignatureVerifiesAgainstThePublicKey() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const manifestBody = JSON.stringify({ id: 'u', runtimeVersion: '1.0.0' });
    const header = signatureHeader(
      manifestBody,
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    // Structured-field shape the expo-updates client parses.
    expect(header).toMatch(/^sig="[^"]+", keyid="main", alg="rsa-v1_5-sha256"$/);
    // The embedded signature must actually verify over the exact manifest body.
    const signatureMatch = expectDefined(/sig="([^"]+)"/.exec(header), 'signature match');
    const arrayElement = expectArrayElement(signatureMatch, 1, 'signature match');
    const signature = Buffer.from(arrayElement, 'base64');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(manifestBody);
    verifier.end();
    expect(verifier.verify(publicKey, signature)).toBe(true);
  }

  it(
    'produces an expo-signature header whose RSA-SHA256 signature verifies against the public key',
    producesAnExpoSignatureHeaderWhoseRSASHA256SignatureVerifiesAgainstThePublicKey,
  );
}

describe('signatureHeader', describeSignatureHeader);
