import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { ConfigCommandInputSchema } from './configCommand.js';

describe('ConfigCommandInputSchema', () => {
  it('decodes schema and validation operations', () => {
    expect(
      Schema.decodeUnknownSync(ConfigCommandInputSchema)({
        operation: 'schema',
        out: 'launch.schema.json',
      }),
    ).toEqual({ operation: 'schema', out: 'launch.schema.json' });
    expect(Schema.decodeUnknownSync(ConfigCommandInputSchema)({ operation: 'validate' })).toEqual({
      operation: 'validate',
    });
  });

  it('rejects an unknown operation', () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigCommandInputSchema)({ operation: 'repair' }),
    ).toThrow();
  });
});
