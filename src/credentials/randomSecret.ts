import { randomBytes } from 'node:crypto';
import { Effect } from 'effect';

export const randomHexSecret = (byteCount: number): Effect.Effect<string> =>
  Effect.sync(() => randomBytes(byteCount).toString('hex'));
