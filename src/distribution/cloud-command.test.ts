import { describe, expect, it } from 'vitest';
import { CloudCommandInputSchema } from './cloud-command.ts';

function describeCloudCommandPieceSchema() {
  function runOperation(operation: 'status' | 'doctor' | 'setup' | 'teardown') {
    const cloudCommandSchema = CloudCommandInputSchema({ operation, yes: false });
    expect(cloudCommandSchema).toEqual({ operation, yes: false });
  }

  it.each(['setup', 'status', 'teardown', 'doctor'] as const)(
    'decodes the %s operation',
    runOperation,
  );

  function rejectsUnknownOperationsBeforeAnyProviderIsCalled() {
    function callCloudCommandPieceSchema() {
      return CloudCommandInputSchema({ operation: 'restart', yes: false });
    }

    expect(callCloudCommandPieceSchema).toThrow('Cloud command operation is unknown.');
  }

  it(
    'rejects unknown operations before any provider is called',
    rejectsUnknownOperationsBeforeAnyProviderIsCalled,
  );
}

describe('CloudCommandInputSchema', describeCloudCommandPieceSchema);
