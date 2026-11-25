import { Effect, Random } from 'effect';
import { describe, expect, it } from 'vitest';
import { randomHexSecret } from './randomSecret.js';

describe('credential password entropy', () => {
  it('returns different hex secrets on each call under a fixed Effect Random seed', async () => {
    const firstSecret = await Effect.runPromise(
      randomHexSecret(24).pipe(Effect.withRandom(Random.make(0))),
    );
    const secondSecret = await Effect.runPromise(
      randomHexSecret(24).pipe(Effect.withRandom(Random.make(0))),
    );

    expect(firstSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(secondSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(firstSecret).not.toBe(secondSecret);
  });
});
