import { describe, expect, it } from 'vitest';
import { decodeSecretCommandInput } from './secretCommand.js';

describe('SecretCommandInputSchema', () => {
  it('decodes the set boundary with an explicit value', () => {
    expect(
      decodeSecretCommandInput({
        action: 'set',
        name: 'API_TOKEN',
        value: 'secret',
        app: 'demo',
        yes: true,
      }),
    ).toEqual({
      action: 'set',
      name: 'API_TOKEN',
      value: 'secret',
      app: 'demo',
      yes: true,
    });
  });

  it('rejects an unknown secret action', () => {
    expect(() => decodeSecretCommandInput({ action: 'show-values' })).toThrow();
  });
});
