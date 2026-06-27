import { describe, expect, it } from 'vitest';
import { shouldNudgeRelease } from './release.js';

describe('shouldNudgeRelease — second confirm only for incremental artifacts', () => {
  it('does not nudge a clean (from-scratch) artifact', () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
  });

  it('nudges an incrementally-built artifact before public release', () => {
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});
