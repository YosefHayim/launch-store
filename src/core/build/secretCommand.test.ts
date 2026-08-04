import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { SecretCommandInputSchema } from './secretCommand.js';

describe('SecretCommandInputSchema', () => {
  it('decodes the set boundary with an explicit value', () => {
    expect(
      Schema.decodeUnknownSync(SecretCommandInputSchema)({
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
    expect(() =>
      Schema.decodeUnknownSync(SecretCommandInputSchema)({ action: 'show-values' }),
    ).toThrow();
  });
});
