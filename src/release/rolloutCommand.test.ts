import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  phasedStateForAction,
  RolloutCommandInputSchema,
  rolloutNotifyStatus,
} from './rolloutCommand.js';

describe('rollout action mapping', () => {
  it('maps every action to Apple and notification states', () => {
    expect(phasedStateForAction('pause')).toBe('PAUSE');
    expect(phasedStateForAction('resume')).toBe('ACTIVE');
    expect(phasedStateForAction('complete')).toBe('COMPLETE');
    expect(rolloutNotifyStatus('pause')).toBe('paused');
    expect(rolloutNotifyStatus('resume')).toBe('resumed');
    expect(rolloutNotifyStatus('complete')).toBe('completed');
  });

  it('rejects unsupported actions at the command boundary', async () => {
    await expect(
      Effect.runPromise(Schema.decodeUnknown(RolloutCommandInputSchema)({ action: 'halt' })),
    ).rejects.toBeDefined();
  });
});
