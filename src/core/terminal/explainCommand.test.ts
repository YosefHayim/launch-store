import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { explainCommandProgram } from './explainCommand.js';

describe('explainCommandProgram', () => {
  it('lists topics when none is requested', async () => {
    const terminalWrites: string[] = [];
    await Effect.runPromise(
      explainCommandProgram({}).pipe(Effect.provide(makeLaunchLoggerTest(terminalWrites))),
    );
    expect(terminalWrites.join('')).toContain('Topics:');
  });

  it('rejects an unknown topic with the known choices', async () => {
    const explanationAttempt = await Effect.runPromise(
      Effect.either(
        explainCommandProgram({ topic: 'magic' }).pipe(Effect.provide(makeLaunchLoggerTest([]))),
      ),
    );
    expect(explanationAttempt._tag).toBe('Left');
    if (explanationAttempt._tag === 'Left') {
      expect(explanationAttempt.left.message).toMatch(/Unknown topic "magic"/);
    }
  });
});
