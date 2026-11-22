import { describe, expect, it } from 'vitest';
import { ConfigCommandInputSchema } from './configCommand.ts';

describe('ConfigCommandInputSchema', () => {
  it('decodes schema and validation operations', () => {
    expect(
      ConfigCommandInputSchema({
        operation: 'schema',
        out: 'launch.schema.json',
      }),
    ).toEqual({ operation: 'schema', out: 'launch.schema.json' });
    expect(ConfigCommandInputSchema({ operation: 'validate' })).toEqual({
      operation: 'validate',
    });
  });

  it('rejects an unknown operation', () => {
    expect(() => ConfigCommandInputSchema({ operation: 'repair' })).toThrow();
  });
});
