import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { retryWithBackoff, runPooledWorkers } from './asyncPool.js';

describe('runPooledWorkers', () => {
  it('preserves input order regardless of completion order', async () => {
    const workerOutcomes = await Effect.runPromise(
      runPooledWorkers([30, 10, 20], 3, (delayMilliseconds) =>
        Effect.sleep(`${delayMilliseconds} millis`).pipe(Effect.as(delayMilliseconds)),
      ),
    );
    expect(workerOutcomes).toEqual([
      { ok: true, value: 30 },
      { ok: true, value: 10 },
      { ok: true, value: 20 },
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    let workersInFlight = 0;
    let peakWorkersInFlight = 0;
    await Effect.runPromise(
      runPooledWorkers(
        Array.from({ length: 10 }, (_, workIndex) => workIndex),
        3,
        () =>
          Effect.gen(function* () {
            workersInFlight += 1;
            peakWorkersInFlight = Math.max(peakWorkersInFlight, workersInFlight);
            yield* Effect.sleep('5 millis');
            workersInFlight -= 1;
          }),
      ),
    );
    expect(peakWorkersInFlight).toBeLessThanOrEqual(3);
  });

  it('isolates a failed item instead of failing the batch', async () => {
    const workerOutcomes = await Effect.runPromise(
      runPooledWorkers([1, 2, 3], 2, (workNumber) => {
        if (workNumber === 2) return Effect.fail(new Error('boom'));
        return Effect.succeed(workNumber * 10);
      }),
    );
    expect(workerOutcomes[0]).toEqual({ ok: true, value: 10 });
    expect(workerOutcomes[1]).toMatchObject({ ok: false });
    expect(workerOutcomes[1]).toMatchObject({
      error: expect.objectContaining({ message: 'boom' }),
    });
    expect(workerOutcomes[2]).toEqual({ ok: true, value: 30 });
  });

  it('clamps a large limit and handles an empty list', async () => {
    expect(await Effect.runPromise(runPooledWorkers([], 8, () => Effect.succeed(1)))).toEqual([]);
    const workerOutcomes = await Effect.runPromise(
      runPooledWorkers([1, 2], 99, (workNumber) => Effect.succeed(workNumber)),
    );
    expect(workerOutcomes).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });
});

describe('retryWithBackoff', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const attemptBuild = vi.fn(() => Effect.succeed('ok'));
    const completedBuild = await Effect.runPromise(
      retryWithBackoff(Effect.suspend(attemptBuild), {
        baseDelayMs: 0,
        isRetryableError: () => true,
      }),
    );
    expect(completedBuild).toBe('ok');
    expect(attemptBuild).toHaveBeenCalledTimes(1);
  });

  it('retries retryable failures before succeeding', async () => {
    let attemptNumber = 0;
    const attemptBuild = vi.fn(() => {
      attemptNumber += 1;
      if (attemptNumber < 3) return Effect.fail(new Error('429'));
      return Effect.succeed('done');
    });
    const completedBuild = await Effect.runPromise(
      retryWithBackoff(Effect.suspend(attemptBuild), {
        baseDelayMs: 0,
        isRetryableError: () => true,
      }),
    );
    expect(completedBuild).toBe('done');
    expect(attemptBuild).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent failure', async () => {
    const permanentFailure = new Error('403');
    const attemptBuild = vi.fn(() => Effect.fail(permanentFailure));
    await expect(
      Effect.runPromise(
        retryWithBackoff(Effect.suspend(attemptBuild), {
          baseDelayMs: 0,
          isRetryableError: () => false,
        }),
      ),
    ).rejects.toThrow('403');
    expect(attemptBuild).toHaveBeenCalledTimes(1);
  });

  it('returns the original failure after the attempt budget', async () => {
    const transientFailure = new Error('still 429');
    const attemptBuild = vi.fn(() => Effect.fail(transientFailure));
    await expect(
      Effect.runPromise(
        retryWithBackoff(Effect.suspend(attemptBuild), {
          maxAttempts: 3,
          baseDelayMs: 0,
          isRetryableError: () => true,
        }),
      ),
    ).rejects.toThrow('still 429');
    expect(attemptBuild).toHaveBeenCalledTimes(3);
  });
});
