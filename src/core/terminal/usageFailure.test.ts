import { Effect } from 'effect';
import { describe, expect, test } from 'vitest';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { endWithUsageFailure, makeUsageFailure } from './usageFailure.js';

describe('endWithUsageFailure', () => {
  const usageFailure = makeUsageFailure({ message: '--days is wrong.' });

  const end = (isJson: boolean) => {
    const lines: string[] = [];
    const finished = Effect.runPromise(
      endWithUsageFailure(usageFailure, isJson).pipe(
        Effect.flip,
        Effect.provide(makeLaunchLoggerTest(lines)),
      ),
    );
    return finished.then((commandExit) => ({ commandExit, lines }));
  };

  test('prints one JSON object and exits 2 with --json', async () => {
    const { commandExit, lines } = await end(true);

    expect(commandExit).toMatchObject({ _tag: 'CommandExit', exitCode: 2 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ ok: false, error: '--days is wrong.' });
  });

  test('prints the message as an error line and exits 2 without --json', async () => {
    const { commandExit, lines } = await end(false);

    expect(commandExit).toMatchObject({ exitCode: 2, message: '--days is wrong.' });
    expect(lines.join('\n')).toContain('--days is wrong.');
  });
});
