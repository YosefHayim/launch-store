import { describe, expect, it } from 'vitest';
import { ConfigCommandInputSchema } from './config-command.ts';

describe('ConfigCommandInputSchema', () => {
  it('decodes schema and validation operations', () => {
    const commandSchema = ConfigCommandInputSchema({
      operation: 'schema',
      out: 'launch.schema.json',
    });
    expect(commandSchema).toEqual({ operation: 'schema', out: 'launch.schema.json' });
    expect(ConfigCommandInputSchema({ operation: 'validate' })).toEqual({
      operation: 'validate',
    });
  });

  it('rejects an unknown operation', () => {
    expect(() => ConfigCommandInputSchema({ operation: 'repair' })).toThrow();
  });
});
