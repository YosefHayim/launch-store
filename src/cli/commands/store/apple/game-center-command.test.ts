import { describe, expect, it } from 'vitest';
import { GameCenterCommandInputSchema } from './game-center-command.ts';
function describeGameCenterCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
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
  }

  it(
    'decodes the Commander boundary with an omitted app selector',
    decodesTheCommanderBoundaryWithAnOmittedAppSelector,
  );

  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callGameCenterCommandPieceSchema() {
      return GameCenterCommandInputSchema({
        app: undefined,
        config: 'gamecenter.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      });
    }

    expect(callGameCenterCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('GameCenterCommandInputSchema', describeGameCenterCommandPieceSchema);
