import { describe, expect, it } from 'vitest';
import { randomHexSecret } from './random-secret.ts';

function describeCredentialPasswordEntropy() {
  function returnsDifferentHexSecretsOnEachCall() {
    const firstSecret = randomHexSecret(24);
    const secondSecret = randomHexSecret(24);

    expect(firstSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(secondSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(firstSecret).not.toBe(secondSecret);
  }

  it('returns different hex secrets on each call', returnsDifferentHexSecretsOnEachCall);
}

describe('credential password entropy', describeCredentialPasswordEntropy);
