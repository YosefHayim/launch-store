import { describe, expect, it } from 'vitest';
import { shouldNudgeRelease } from './release.js';

describe('release CLI re-export', () => {
  it('keeps shouldNudgeRelease available for thin CLI consumers', () => {
    expect(shouldNudgeRelease({ clean: true })).toBe(false);
    expect(shouldNudgeRelease({ clean: false })).toBe(true);
  });
});
