import { describe, expect, it } from 'vitest';
import { registerBuildsCommand } from './builds.js';

describe('registerBuildsCommand', () => {
  it('is the thin Commander registration entry for build history', () => {
    expect(typeof registerBuildsCommand).toBe('function');
  });
});
