import { describe, expect, it } from 'vitest';
import { ConfigCommandInputSchema } from './config-command.ts';
function describePieceCommandPieceSchema() {
  function decodesSchemaAndValidationOperations() {
    const commandSchema = ConfigCommandInputSchema({
      operation: 'schema',
      out: 'launch.schema.json',
    });
    expect(commandSchema).toEqual({ operation: 'schema', out: 'launch.schema.json' });
    expect(ConfigCommandInputSchema({ operation: 'validate' })).toEqual({
      operation: 'validate',
    });
  }

  it('decodes schema and validation operations', decodesSchemaAndValidationOperations);
  function rejectsAnUnknownOperation() {
    function callPieceCommandPieceSchema() {
      return ConfigCommandInputSchema({ operation: 'repair' });
    }

    expect(callPieceCommandPieceSchema).toThrow();
  }

  it('rejects an unknown operation', rejectsAnUnknownOperation);
}

describe('ConfigCommandInputSchema', describePieceCommandPieceSchema);
