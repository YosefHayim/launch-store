import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { PlaySubscriptionsCommandInputSchema } from './playSubscriptionsCommand.js';

describe('PlaySubscriptionsCommandInputSchema', () => {
  it('decodes the Commander boundary', () => {
    expect(
      Schema.decodeUnknownSync(PlaySubscriptionsCommandInputSchema)({
        app: 'mobile',
        dryRun: false,
        yes: true,
      }),
    ).toEqual({ app: 'mobile', dryRun: false, yes: true });
  });

  it('accepts an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(PlaySubscriptionsCommandInputSchema)({
        dryRun: true,
        yes: false,
      }),
    ).toEqual({ dryRun: true, yes: false });
  });

  it('rejects an undefined exact optional app', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlaySubscriptionsCommandInputSchema)({
        app: undefined,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
