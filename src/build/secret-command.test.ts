import { describe, expect, it } from 'vitest';
import { decodeSecretCommandInput } from './secret-command.ts';

describe('SecretCommandInputSchema', () => {
  it('decodes the set boundary with an explicit value', () => {
    const decodeSecretCommand = decodeSecretCommandInput({
      action: 'set',
      name: 'API_TOKEN',
      value: 'secret',
      app: 'demo',
      yes: true,
    });
    expect(decodeSecretCommand).toEqual({
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
