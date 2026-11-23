import { describe, expect, it } from 'vitest';
import { GameCenterCommandInputSchema } from './game-center-command.ts';

function describeGameCenterCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
    const gameCenterCommandSchema = GameCenterCommandInputSchema({
      dryRun: true,
      yes: false,
    });

    expect(gameCenterCommandSchema).toEqual({
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
