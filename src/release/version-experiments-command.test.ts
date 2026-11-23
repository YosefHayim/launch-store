import { describe, expect, it } from 'vitest';
import { decodeVersionExperimentsCommandInput } from './version-experiments-command.ts';

function describeDecodeVersionExperimentsCommandPiece() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
    const decodeVersionExperimentsCommand = decodeVersionExperimentsCommandInput({
      config: 'experiments.config.json',
      submit: true,
      start: false,
      dryRun: true,
      yes: false,
    });

    expect(decodeVersionExperimentsCommand).toEqual({
      config: 'experiments.config.json',
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
        config: 'experiments.config.json',
        submit: false,
        start: false,
        dryRun: false,
        yes: false,
      });
    }

    expect(callDecodeVersionExperimentsCommandPiece).toThrowError(
      expect.objectContaining({ _tag: 'VersionExperimentsCommandFailure' }),
    );
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('decodeVersionExperimentsCommandInput', describeDecodeVersionExperimentsCommandPiece);
