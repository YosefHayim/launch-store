import { describe, expect, it } from 'vitest';

import { readAppleKey, readStoredSecret } from './keychain.js';

describe('readAppleKey', () => {
  it('reads the saved Apple key', () => {
    const key = readAppleKey(
      JSON.stringify({ keyId: 'KEY', issuerId: 'ISSUER', privateKey: 'pem' }),
    );

    expect(key.keyId).toBe('KEY');
  });

  it('rejects a key that is not json', () => {
    expect(() => readAppleKey('not-json')).toThrow('not valid JSON');
  });

  it('reads a secret saved by the old keychain addon', () => {
    expect(readStoredSecret('{"keyId":"KEY"}\n')).toBe('{"keyId":"KEY"}');
  });

  it('reads a base64 secret that contains a newline', () => {
    const stored = Buffer.from('line1\nline2', 'utf8').toString('base64');

    expect(readStoredSecret(`${stored}\n`)).toBe('line1\nline2');
  });
});
