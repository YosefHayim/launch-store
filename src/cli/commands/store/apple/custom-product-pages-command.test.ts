import { describe, expect, it } from 'vitest';
import { CustomProductPagesCommandInputSchema } from './custom-product-pages-command.ts';
function describeCustomProductPagesCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
    const customProductPagesCommandSchema = CustomProductPagesCommandInputSchema({
      config: 'custom-pages.config.json',
      dryRun: true,
      yes: false,
    });
    expect(customProductPagesCommandSchema).toEqual({
      config: 'custom-pages.config.json',
      dryRun: true,
      yes: false,
    });
  }

  it(
    'decodes the Commander boundary with an omitted app selector',
    decodesTheCommanderBoundaryWithAnOmittedAppSelector,
  );
  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callCustomProductPagesCommandPieceSchema() {
      return CustomProductPagesCommandInputSchema({
        app: undefined,
        config: 'custom-pages.config.json',
        dryRun: false,
        yes: false,
      });
    }

    expect(callCustomProductPagesCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('CustomProductPagesCommandInputSchema', describeCustomProductPagesCommandPieceSchema);
