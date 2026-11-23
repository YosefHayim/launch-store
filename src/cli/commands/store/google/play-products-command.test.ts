import { describe, expect, it } from 'vitest';
import { PlayProductsCommandInputSchema } from './play-products-command.ts';
function describePlayProductsCommandPieceSchema() {
  function decodesTheCommanderBoundary() {
    const playProductsCommandSchema = PlayProductsCommandInputSchema({
      app: 'mobile',
      dryRun: true,
      yes: false,
    });

    expect(playProductsCommandSchema).toEqual({ app: 'mobile', dryRun: true, yes: false });
  }

  it('decodes the Commander boundary', decodesTheCommanderBoundary);

  function acceptsAnOmittedAppSelector() {
    const playProductsCommandSchema = PlayProductsCommandInputSchema({
      dryRun: false,
      yes: false,
    });

    expect(playProductsCommandSchema).toEqual({ dryRun: false, yes: false });
  }

  it('accepts an omitted app selector', acceptsAnOmittedAppSelector);

  function rejectsMissingConfirmationBooleans() {
    function callPlayProductsCommandPieceSchema() {
      return PlayProductsCommandInputSchema({ dryRun: true });
    }

    expect(callPlayProductsCommandPieceSchema).toThrow();
  }

  it('rejects missing confirmation booleans', rejectsMissingConfirmationBooleans);
}

describe('PlayProductsCommandInputSchema', describePlayProductsCommandPieceSchema);
