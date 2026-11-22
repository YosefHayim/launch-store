import { describe, expect, it } from 'vitest';
import { randomHexSecret } from './randomSecret.js';

describe('credential password entropy', () => {
  it('returns different hex secrets on each call', () => {
    const firstSecret = randomHexSecret(24);
    const secondSecret = randomHexSecret(24);

    expect(firstSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(secondSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(firstSecret).not.toBe(secondSecret);
  });
});
