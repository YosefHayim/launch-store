import { describe, expect, it } from 'vitest';
import { CloudCommandInputSchema } from './cloudCommand.ts';

describe('CloudCommandInputSchema', () => {
  it.each(['setup', 'status', 'teardown', 'doctor'] as const)(
    'decodes the %s operation',
    (operation) => {
      expect(CloudCommandInputSchema({ operation, yes: false })).toEqual({ operation, yes: false });
    },
  );

  it('rejects unknown operations before any provider is called', () => {
    expect(() => CloudCommandInputSchema({ operation: 'restart', yes: false })).toThrow(
      'Cloud command operation is unknown.',
    );
  });
});
