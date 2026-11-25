import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { AppClipsCommandInputSchema } from './appClipsCommand.js';

describe('AppClipsCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(AppClipsCommandInputSchema)({
        config: 'appclips.config.json',
        explicitConfig: false,
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      config: 'appclips.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      Schema.decodeUnknownSync(AppClipsCommandInputSchema)({
        app: undefined,
        config: 'appclips.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
