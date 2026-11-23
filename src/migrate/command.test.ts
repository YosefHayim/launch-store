import { describe, expect, it } from 'vitest';
import { MigrateCommandInputSchema } from './command.ts';

function describeMigrateCommandPieceSchema() {
  function acceptsEasAndFastlaneWithForceDryRunAndOptionalOut() {
    const migrateCommandSchema = MigrateCommandInputSchema({
      source: 'eas',
      force: false,
      dryRun: true,
      out: '/tmp/out',
    });

    expect(migrateCommandSchema).toEqual({
      source: 'eas',
      force: false,
      dryRun: true,
      out: '/tmp/out',
    });
    expect(
      MigrateCommandInputSchema({
        source: 'fastlane',
        force: true,
        dryRun: false,
      }),
    ).toEqual({
      source: 'fastlane',
      force: true,
      dryRun: false,
    });
  }

  it(
    'accepts eas and fastlane with force, dryRun, and optional out',
    acceptsEasAndFastlaneWithForceDryRunAndOptionalOut,
  );

  function rejectsAnUnknownMigrationPiece() {
    function callMigrateCommandPieceSchema() {
      return MigrateCommandInputSchema({
        source: 'codemagic',
        force: false,
        dryRun: false,
      });
    }

    expect(callMigrateCommandPieceSchema).toThrow();
  }

  it('rejects an unknown migration source', rejectsAnUnknownMigrationPiece);
}

describe('MigrateCommandInputSchema', describeMigrateCommandPieceSchema);
