import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { GameCenterCommandInputSchema } from './gameCenterCommand.js';

describe('GameCenterCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    expect(
      Schema.decodeUnknownSync(GameCenterCommandInputSchema)({
        config: 'gamecenter.config.json',
        explicitConfig: false,
        dryRun: true,
        yes: false,
      }),
    ).toEqual({
      config: 'gamecenter.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      Schema.decodeUnknownSync(GameCenterCommandInputSchema)({
        app: undefined,
        config: 'gamecenter.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
