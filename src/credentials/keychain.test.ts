import { describe, expect, it } from 'vitest';

import { readAppleKey } from './keychain.js';

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
});
