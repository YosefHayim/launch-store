import { describe, expect, it } from 'vitest';
import { Schema } from 'effect';
import { PlayProductsCommandInputSchema } from './playProductsCommand.js';

describe('PlayProductsCommandInputSchema', () => {
  it('decodes the Commander boundary', () => {
    expect(
      Schema.decodeUnknownSync(PlayProductsCommandInputSchema)({
        app: 'mobile',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({ app: 'mobile', dryRun: true, yes: false });
  });

  it('accepts an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(PlayProductsCommandInputSchema)({
        dryRun: false,
        yes: false,
      }),
    ).toEqual({ dryRun: false, yes: false });
  });

  it('rejects missing confirmation booleans', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlayProductsCommandInputSchema)({ dryRun: true }),
    ).toThrow();
  });
});
