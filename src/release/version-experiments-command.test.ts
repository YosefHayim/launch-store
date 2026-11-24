import { describe, expect, it } from 'vitest';
import { decodeVersionExperimentsCommandInput } from './version-experiments-command.ts';

function describeDecodeVersionExperimentsCommandPiece() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
    const decodeVersionExperimentsCommand = decodeVersionExperimentsCommandInput({
      submit: true,
      start: false,
      dryRun: true,
      yes: false,
    });

    expect(decodeVersionExperimentsCommand).toEqual({
      submit: true,
      start: false,
      dryRun: true,
      yes: false,
    });
  }

  it(
    'decodes the Commander boundary with an omitted app selector',
    decodesTheCommanderBoundaryWithAnOmittedAppSelector,
  );

  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callDecodeVersionExperimentsCommandPiece() {
      return decodeVersionExperimentsCommandInput({
        app: undefined,
        submit: false,
        start: false,
        dryRun: false,
        yes: false,
      });
    }

    expect(callDecodeVersionExperimentsCommandPiece).toThrowError(
      expect.objectContaining({
        message: 'Experiments command app must be a string when it is present.',
      }),
    );
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('decodeVersionExperimentsCommandInput', describeDecodeVersionExperimentsCommandPiece);
