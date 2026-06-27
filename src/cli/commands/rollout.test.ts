import { describe, expect, it } from 'vitest';
import { phasedStateForAction, rolloutNotifyStatus } from './rollout.js';

describe('phasedStateForAction', () => {
  it('maps each verb to its App Store Connect phased-release state', () => {
    expect(phasedStateForAction('pause')).toBe('PAUSE');
    expect(phasedStateForAction('resume')).toBe('ACTIVE');
    expect(phasedStateForAction('complete')).toBe('COMPLETE');
  });

  it('throws on an unknown verb', () => {
    expect(() => phasedStateForAction('halt')).toThrow(/Unknown rollout action "halt"/);
  });
});

describe('rolloutNotifyStatus', () => {
  it('maps each verb to its notification status', () => {
    expect(rolloutNotifyStatus('pause')).toBe('paused');
    expect(rolloutNotifyStatus('resume')).toBe('resumed');
    expect(rolloutNotifyStatus('complete')).toBe('completed');
  });

  it('throws on an unknown verb', () => {
    expect(() => rolloutNotifyStatus('halt')).toThrow(/Unknown rollout action "halt"/);
  });
});
