import { describe, expect, it } from 'vitest';
import { PlayProductsCommandInputSchema } from './play-products-command.ts';

describe('PlayProductsCommandInputSchema', () => {
  it('decodes the Commander boundary', () => {
    const playProductsCommandSchema = PlayProductsCommandInputSchema({
      app: 'mobile',
      dryRun: true,
      yes: false,
    });
    expect(playProductsCommandSchema).toEqual({ app: 'mobile', dryRun: true, yes: false });
  });

  it('accepts an omitted app selector', () => {
    const playProductsCommandSchema = PlayProductsCommandInputSchema({
      dryRun: false,
      yes: false,
    });
    expect(playProductsCommandSchema).toEqual({ dryRun: false, yes: false });
  });

  it('rejects missing confirmation booleans', () => {
    expect(() => PlayProductsCommandInputSchema({ dryRun: true })).toThrow();
  });
});
