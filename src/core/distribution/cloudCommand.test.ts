import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { CloudCommandInputSchema } from './cloudCommand.js';

describe('CloudCommandInputSchema', () => {
  it.each([
    'setup',
    'status',
    'teardown',
    'doctor',
  ] as const)('decodes the %s operation', (operation) => {
    const commandInput = Effect.runSync(
      Schema.decodeUnknown(CloudCommandInputSchema)({ operation, yes: false }),
    );
    expect(commandInput).toEqual({ operation, yes: false });
  });

  it('rejects unknown operations before any provider is called', () => {
    const commandInput = Schema.decodeUnknownEither(CloudCommandInputSchema)({
      operation: 'restart',
      yes: false,
    });
    expect(commandInput._tag).toBe('Left');
  });
});
