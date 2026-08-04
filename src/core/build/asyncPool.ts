import { Effect, Schedule } from 'effect';

export type WorkerResult<TValue> =
  | {
      readonly ok: true;
      readonly value: TValue;
    }
  | {
      readonly ok: false;
      readonly error: unknown;
    };

export type RetryPolicy = {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly isRetryableError: (encounteredError: unknown) => boolean;
};

export const runPooledWorkers = <TItem, TValue, TError>(
  workItems: readonly TItem[],
  concurrencyLimit: number,
  processWorkItem: (workItem: TItem) => Effect.Effect<TValue, TError>,
): Effect.Effect<readonly WorkerResult<TValue>[]> =>
  Effect.forEach(
    workItems,
    (workItem) =>
      processWorkItem(workItem).pipe(
        Effect.map((completedWork): WorkerResult<TValue> => ({ ok: true, value: completedWork })),
        Effect.catchAll(
          (encounteredError): Effect.Effect<WorkerResult<TValue>> =>
            Effect.succeed({ ok: false, error: encounteredError }),
        ),
      ),
    { concurrency: Math.max(1, Math.min(concurrencyLimit, workItems.length)) },
  );

export const retryWithBackoff = <TValue, TError>(
  effectToRetry: Effect.Effect<TValue, TError>,
  retryPolicy: RetryPolicy,
): Effect.Effect<TValue, TError> => {
  let maximumAttempts = retryPolicy.maxAttempts;
  if (maximumAttempts === undefined) maximumAttempts = 4;
  let baseDelayMilliseconds = retryPolicy.baseDelayMs;
  if (baseDelayMilliseconds === undefined) baseDelayMilliseconds = 500;
  let maximumDelayMilliseconds = retryPolicy.maxDelayMs;
  if (maximumDelayMilliseconds === undefined) maximumDelayMilliseconds = 8000;

  const retrySchedule = Schedule.exponential(`${baseDelayMilliseconds} millis`).pipe(
    Schedule.either(Schedule.spaced(`${maximumDelayMilliseconds} millis`)),
    Schedule.compose(Schedule.recurs(maximumAttempts - 1)),
    Schedule.whileInput((encounteredError: TError) =>
      retryPolicy.isRetryableError(encounteredError),
    ),
  );
  return effectToRetry.pipe(Effect.retry(retrySchedule));
};
