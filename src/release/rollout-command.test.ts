import { describe, expect, it } from 'vitest';
import { decodeRolloutCommandInput, phasedStateForAction } from './rollout-command.ts';

function describeRolloutActionMapping() {
  function mapsEveryActionToAnApplePhasedReleaseState() {
    const phasedForAction = phasedStateForAction('pause');

    expect(phasedForAction).toBe('PAUSE');
    expect(phasedStateForAction('resume')).toBe('ACTIVE');
    expect(phasedStateForAction('complete')).toBe('COMPLETE');
  }

  it(
    'maps every action to an Apple phased-release state',
    mapsEveryActionToAnApplePhasedReleaseState,
  );

  function rejectsUnsupportedActionsAtTheCommandBoundary() {
    function callDecodeRolloutCommandPiece() {
      return decodeRolloutCommandInput({ action: 'halt' });
    }

    expect(callDecodeRolloutCommandPiece).toThrowError(
      expect.objectContaining({
        message: 'Rollout action must be pause, resume, or complete.',
      }),
    );
  }

  it(
    'rejects unsupported actions at the command boundary',
    rejectsUnsupportedActionsAtTheCommandBoundary,
  );
}

describe('rollout action mapping', describeRolloutActionMapping);
