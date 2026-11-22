import { describe, expect, it } from 'vitest';
import { CustomProductPagesCommandInputSchema } from './customProductPagesCommand.ts';

describe('CustomProductPagesCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      CustomProductPagesCommandInputSchema({
        config: 'custom-pages.config.json',
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      config: 'custom-pages.config.json',
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      CustomProductPagesCommandInputSchema({
        app: undefined,
        config: 'custom-pages.config.json',
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
