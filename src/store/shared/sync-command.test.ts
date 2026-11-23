import { describe, expect, it } from 'vitest';
import { SyncCommandInputSchema } from './sync-command.ts';
function describeSyncCommandPieceSchema() {
  function decodesTheCompleteCommanderBoundary() {
    const syncCommandSchema = SyncCommandInputSchema({
      app: 'ios,android',
      dryRun: true,
      allowDestructive: false,
      yes: true,
      snapshot: false,
    });

    expect(syncCommandSchema).toEqual({
      app: 'ios,android',
      dryRun: true,
      allowDestructive: false,
      yes: true,
      snapshot: false,
    });
  }

  it('decodes the complete Commander boundary', decodesTheCompleteCommanderBoundary);

  function rejectsMissingBooleanFlagsBeforeOrchestration() {
    function callSyncCommandPieceSchema() {
      return SyncCommandInputSchema({
        dryRun: true,
        allowDestructive: false,
        yes: true,
      });
    }

    expect(callSyncCommandPieceSchema).toThrow();
  }

  it(
    'rejects missing boolean flags before orchestration',
    rejectsMissingBooleanFlagsBeforeOrchestration,
  );
}

describe('SyncCommandInputSchema', describeSyncCommandPieceSchema);
