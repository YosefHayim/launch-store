import { describe, expect, it } from 'vitest';
import {
  decodeRolloutCommandInput,
  phasedStateForAction,
  rolloutNotifyStatus,
} from './rollout-command.ts';
function describeRolloutActionMapping() {
  function mapsEveryActionToAppleAndNotificationStates() {
    const phasedForAction = phasedStateForAction('pause');
    expect(phasedForAction).toBe('PAUSE');
    expect(phasedStateForAction('resume')).toBe('ACTIVE');
    expect(phasedStateForAction('complete')).toBe('COMPLETE');
    expect(rolloutNotifyStatus('pause')).toBe('paused');
    expect(rolloutNotifyStatus('resume')).toBe('resumed');
    expect(rolloutNotifyStatus('complete')).toBe('completed');
  }

  it(
    'maps every action to Apple and notification states',
    mapsEveryActionToAppleAndNotificationStates,
  );
  function rejectsUnsupportedActionsAtTheCommandBoundary() {
    function callDecodeRolloutCommandPiece() {
      return decodeRolloutCommandInput({ action: 'halt' });
    }

    expect(callDecodeRolloutCommandPiece).toThrowError(
      expect.objectContaining({ _tag: 'RolloutCommandFailure' }),
    );
  }

  it(
    'rejects unsupported actions at the command boundary',
    rejectsUnsupportedActionsAtTheCommandBoundary,
  );
}

describe('rollout action mapping', describeRolloutActionMapping);
