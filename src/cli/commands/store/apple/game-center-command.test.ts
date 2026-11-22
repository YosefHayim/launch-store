import { describe, expect, it } from 'vitest';
import { GameCenterCommandInputSchema } from './game-center-command.ts';

describe('GameCenterCommandInputSchema', () => {
  it('decodes the Commander boundary with an omitted app selector', () => {
    const gameCenterCommandSchema = GameCenterCommandInputSchema({
      config: 'gamecenter.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
    expect(gameCenterCommandSchema).toEqual({
      config: 'gamecenter.config.json',
      explicitConfig: false,
      dryRun: true,
      yes: false,
    });
  });

  it('rejects an explicit undefined exact optional app', () => {
    expect(() =>
      GameCenterCommandInputSchema({
        app: undefined,
        config: 'gamecenter.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});
