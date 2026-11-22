import { describe, expect, it } from 'vitest';
import { AppClipsCommandInputSchema } from './app-clips-command.ts';

describe('AppClipsCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    const appClipsCommandSchema = AppClipsCommandInputSchema({
      config: 'appclips.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
    expect(appClipsCommandSchema).toEqual({
      config: 'appclips.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      AppClipsCommandInputSchema({
        app: undefined,
        config: 'appclips.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
