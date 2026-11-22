import { describe, expect, it } from 'vitest';
import { PlayProductsCommandInputSchema } from './play-products-command.ts';

describe('PlayProductsCommandInputSchema', () => {
  it('decodes the Commander boundary', () => {
    expect(
      PlayProductsCommandInputSchema({
        app: 'mobile',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({ app: 'mobile', dryRun: true, yes: false });
  });

  it('accepts an omitted app selector', () => {
    expect(
      PlayProductsCommandInputSchema({
        dryRun: false,
        yes: false,
      }),
    ).toEqual({ dryRun: false, yes: false });
  });

  it('rejects missing confirmation booleans', () => {
    expect(() => PlayProductsCommandInputSchema({ dryRun: true })).toThrow();
  });
});
