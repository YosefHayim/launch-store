import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { CustomProductPagesCommandInputSchema } from './customProductPagesCommand.js';

describe('CustomProductPagesCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(CustomProductPagesCommandInputSchema)({
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
      Schema.decodeUnknownSync(CustomProductPagesCommandInputSchema)({
        app: undefined,
        config: 'custom-pages.config.json',
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
