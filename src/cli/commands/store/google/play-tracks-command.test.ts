import { describe, expect, it } from 'vitest';
import { describePlayRelease, PlayTracksCommandInputSchema } from './play-tracks-command.ts';
function describePlayTracksCommandPieceSchema() {
  function decodesEachCommanderOperationWithoutUnsetOptionFields() {
    const playTracksCommandSchema = PlayTracksCommandInputSchema({
      operation: 'status',
      json: false,
    });
    expect(playTracksCommandSchema).toEqual({ operation: 'status', json: false });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'promote',
        track: 'production',
        yes: true,
      }),
    ).toEqual({ operation: 'promote', track: 'production', yes: true });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'promote',
        track: 'internal',
        versionCode: '8',
        notes: 'notes.json',
        yes: true,
      }),
    ).toEqual({
      operation: 'promote',
      track: 'internal',
      versionCode: '8',
      notes: 'notes.json',
      yes: true,
    });
    expect(
      PlayTracksCommandInputSchema({
        operation: 'testers',
        track: 'internal',
        yes: false,
      }),
    ).toEqual({ operation: 'testers', track: 'internal', yes: false });
  }

  it(
    'decodes each Commander operation without unset option fields',
    decodesEachCommanderOperationWithoutUnsetOptionFields,
  );
  function rejectsExplicitUndefinedExactOptionalFields() {
    function callPlayTracksCommandPieceSchema() {
      return PlayTracksCommandInputSchema({
        operation: 'promote',
        app: undefined,
        track: 'production',
        yes: false,
      });
    }

    expect(callPlayTracksCommandPieceSchema).toThrow();
  }

  it(
    'rejects explicit undefined exact optional fields',
    rejectsExplicitUndefinedExactOptionalFields,
  );
}

describe('PlayTracksCommandInputSchema', describePlayTracksCommandPieceSchema);
function describeDescribePlayRelease() {
  function rendersStatusBuildsRolloutAndNotesWithASCIIPiece() {
    const playRelease = describePlayRelease({
      status: 'inProgress',
      versionCodes: ['42'],
      userFraction: 0.25,
      releaseNotes: [{ language: 'en-US', text: 'Faster startup' }],
    });
    expect(playRelease).toBe('inProgress  v42  25% rollout  1 note(s)');
  }

  it(
    'renders status, builds, rollout, and notes with ASCII text',
    rendersStatusBuildsRolloutAndNotesWithASCIIPiece,
  );
}

describe('describePlayRelease', describeDescribePlayRelease);
