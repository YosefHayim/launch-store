import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { OpenCommandInputSchema } from './openCommand.js';

describe('OpenCommandInputSchema', () => {
  it('keeps the target and optional selectors from Commander', async () => {
    const commandInput = await Effect.runPromise(
      Schema.decodeUnknown(OpenCommandInputSchema)({
        target: 'reviews',
        platform: 'ios',
        app: 'sample',
      }),
    );
    expect(commandInput).toEqual({
      target: 'reviews',
      platform: 'ios',
      app: 'sample',
    });
  });
});
