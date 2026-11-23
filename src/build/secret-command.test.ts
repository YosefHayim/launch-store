import { describe, expect, it } from 'vitest';
import { decodeSecretCommandInput } from './secret-command.ts';
function describeSecretCommandPieceSchema() {
  function decodesTheSetBoundaryWithAnExplicitPiece() {
    const decodeSecretCommand = decodeSecretCommandInput({
      action: 'set',
      name: 'API_TOKEN',
      value: 'secret',
      app: 'demo',
      yes: true,
    });
    expect(decodeSecretCommand).toEqual({
      action: 'set',
      name: 'API_TOKEN',
      value: 'secret',
      app: 'demo',
      yes: true,
    });
  }

  it('decodes the set boundary with an explicit value', decodesTheSetBoundaryWithAnExplicitPiece);
  function rejectsAnUnknownSecretAction() {
    function callDecodeSecretCommandPiece() {
      return decodeSecretCommandInput({ action: 'show-values' });
    }

    expect(callDecodeSecretCommandPiece).toThrow();
  }

  it('rejects an unknown secret action', rejectsAnUnknownSecretAction);
}

describe('SecretCommandInputSchema', describeSecretCommandPieceSchema);
