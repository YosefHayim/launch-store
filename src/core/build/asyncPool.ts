/**
 * Concurrency primitives for driving APIs safely in parallel.
 *
 * - {@link runPooledWorkers} — bounded concurrency with per-item error isolation, so one failure
 *   never rejects the whole batch (`launch sync` over 40 apps reports a per-app summary).
 * - {@link retryWithBackoff} — exponential backoff on transient failures (HTTP 429 / 5xx).
 *
 * Both use Effect's built-in combinators. No manual Promise pools or await-in-loops.
 */

import { Data, Effect, Schedule } from 'effect';

// ─── Errors ────────────────────────────────────────────────────────────────

export class RetriesExhaustedError extends Data.TaggedError('RetriesExhaustedError')<{
  readonly lastError: unknown;
  readonly attemptsUsed: number;
}> {}

// ─── Types ─────────────────────────────────────────────────────────────────

/** The isolated outcome of one pooled worker item. */
export type WorkerResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: unknown };

/** Compatibility result for Promise callers that have not migrated to {@link WorkerResult}. */
export type PoolResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: Error };

// ─── Pool ──────────────────────────────────────────────────────────────────

/**
 * Run `processItem` over `itemsToProcess` with at most `concurrencyLimit` in flight, preserving
 * input order. A failing item is captured as `{ ok: false }` — never rejects the batch.
 */
export const runPooledWorkers = <TItem, TValue, TError>(
  itemsToProcess: readonly TItem[],
  concurrencyLimit: number,
  processItem: (item: TItem) => Effect.Effect<TValue, TError>,
): Effect.Effect<readonly WorkerResult<TValue>[]> =>
  Effect.forEach(
    itemsToProcess,
    (currentItem) =>
      processItem(currentItem).pipe(
        Effect.map((completedValue): WorkerResult<TValue> => ({ ok: true, value: completedValue })),
        Effect.catchAll(
          (encounteredError): Effect.Effect<WorkerResult<TValue>> =>
            Effect.succeed({ ok: false, error: encounteredError }),
        ),
      ),
    { concurrency: Math.max(1, Math.min(concurrencyLimit, itemsToProcess.length)) },
  );

// ─── Retry ─────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Total attempts including the first try. Defaults to 4. */
  maxAttempts?: number;
  /** Base backoff in ms (attempt N waits `baseDelayMs * 2^(N-1)`). Defaults to 500. */
  baseDelayMs?: number;
  /** Upper bound on a single wait in ms. Defaults to 8000. */
  maxDelayMs?: number;
  /** Whether an error is worth retrying. Non-retryable errors fail immediately. */
  isRetryableError: (error: unknown) => boolean;
}

/**
 * Retry an Effect on transient failure with exponential backoff. Non-retryable errors fail
 * immediately. Rethrows the last error once attempts are exhausted.
 */
export const retryWithBackoff = <TValue, TError>(
  effectToRetry: Effect.Effect<TValue, TError>,
  policy: RetryPolicy,
): Effect.Effect<TValue, TError | RetriesExhaustedError> => {
  const maxAttempts = policy.maxAttempts ?? 4;
  const baseDelayMs = policy.baseDelayMs ?? 500;
  const maxDelayMs = policy.maxDelayMs ?? 8000;

  return effectToRetry.pipe(
    Effect.retry(
      Schedule.exponential(`${baseDelayMs} millis`).pipe(
        Schedule.either(Schedule.spaced(`${maxDelayMs} millis`)),
        Schedule.compose(Schedule.recurs(maxAttempts - 1)),
        Schedule.whileInput((error: TError) => policy.isRetryableError(error)),
      ),
    ),
  );
};

// ─── Imperative shims (callers migrate progressively) ──────────────────────

/** Tuning for {@link withRetry}; use {@link RetryPolicy} in new code. */
export interface RetryOptions {
  /** Total attempts including the first try. Defaults to 4. */
  attempts?: number;
  /** Base backoff in ms. Defaults to 500. */
  baseMs?: number;
  /** Upper bound on a single wait in ms. Defaults to 8000. */
  maxDelayMs?: number;
  /** Whether an error is worth retrying. Non-retryable errors rethrow immediately. */
  isRetryable: (error: unknown) => boolean;
  /** Sleep implementation; overridable so tests run without real timers. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Convert an unknown thrown value into an Error for the legacy pool result shape.
 *
 * @param error - Unknown thrown value from a Promise worker.
 * @returns The original Error or a new Error wrapping the value.
 */
const normalizePoolError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Resolve after `milliseconds` using a real timer.
 *
 * @param milliseconds - Delay length in milliseconds.
 * @returns A Promise that resolves after the delay.
 */
const realSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Legacy Promise pool kept for current callers while they migrate to {@link runPooledWorkers}.
 *
 * @param items - Items to process.
 * @param limit - Maximum number of in-flight workers.
 * @param worker - Promise-returning worker for one item and its index.
 * @returns A Promise that resolves with per-item success/failure results in input order.
 */
export const runPool = async <TItem, TValue>(
  items: readonly TItem[],
  limit: number,
  worker: (item: TItem, index: number) => Promise<TValue>,
): Promise<PoolResult<TValue>[]> => {
  const results = new Array<PoolResult<TValue>>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  const entries = items.entries();

  const lane = async (): Promise<void> => {
    for (const [index, item] of entries) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: legacy worker-pool lane; concurrency comes from running several lanes at once.
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = { ok: false, error: normalizePoolError(error) };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, lane));
  return results;
};

/**
 * Legacy Promise retry kept for current ASC callers while they migrate to {@link retryWithBackoff}.
 *
 * @param operation - Promise-returning operation to retry.
 * @param options - Retry tuning and retryability predicate.
 * @returns A Promise that resolves with the operation result or rejects with the last error.
 */
export const withRetry = async <TValue>(
  operation: () => Promise<TValue>,
  options: RetryOptions,
): Promise<TValue> => {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retry attempts are intentionally sequential.
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !options.isRetryable(error)) {
        throw error;
      }
      // biome-ignore lint/performance/noAwaitInLoops: backoff delay is part of the retry contract.
      await sleep(Math.min(maxDelayMs, baseMs * 2 ** (attempt - 1)));
    }
  }

  throw lastError;
};
