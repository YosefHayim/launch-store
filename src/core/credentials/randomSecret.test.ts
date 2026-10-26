import { Effect, Random } from 'effect';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { randomHexSecret } from './randomSecret.js';

vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((byteCount: number) => Buffer.alloc(byteCount, 0xa7)),
}));

describe('credential password entropy', () => {
  it('uses the cryptographic source even when Effect Random is deterministic', async () => {
    const credentialPassword = await Effect.runPromise(
      randomHexSecret(24).pipe(Effect.withRandom(Random.make(0))),
    );
    expect(randomBytes).toHaveBeenCalledWith(24);
    expect(credentialPassword).toBe('a7'.repeat(24));
  });
});
