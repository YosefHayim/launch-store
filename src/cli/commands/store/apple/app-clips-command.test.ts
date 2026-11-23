import { describe, expect, it } from 'vitest';
import { AppClipsCommandInputSchema } from './app-clips-command.ts';
function describeAppClipsCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
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
  }

  it(
    'decodes the Commander boundary with an omitted app selector',
    decodesTheCommanderBoundaryWithAnOmittedAppSelector,
  );

  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callAppClipsCommandPieceSchema() {
      return AppClipsCommandInputSchema({
        app: undefined,
        config: 'appclips.config.json',
        explicitConfig: false,
        dryRun: false,
        yes: false,
      });
    }

    expect(callAppClipsCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('AppClipsCommandInputSchema', describeAppClipsCommandPieceSchema);
