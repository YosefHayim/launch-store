/**
 * Two small primitives for driving the App Store Connect API safely in parallel:
 *
 * - {@link runPool} runs a worker over many items with a hard concurrency cap and PER-ITEM isolation:
 *   one item throwing never rejects the whole batch, so `launch sync` over 40 apps reports a per-app
 *   summary instead of dying on the first failure. The cap is also the proactive throttle — bounding
 *   in-flight work is what keeps a single ASC API key under Apple's rate ceiling.
 * - {@link withRetry} retries a single call on a transient failure (HTTP 429 / 5xx) with exponential
 *   backoff. This is the *reactive* throttle: rather than guess Apple's undocumented per-endpoint
 *   limits with a token bucket, we back off exactly when Apple tells us to with a 429.
 *
 * Both are generic and I/O-free except for the work they're handed, so they unit-test without network.
 */

/** The isolated outcome of one {@link runPool} item: a value on success, the captured error on failure. */
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: Error };

/**
 * Run `worker` over `items` with at most `limit` running concurrently, preserving input order in the
 * result array. A worker that throws is captured as `{ ok: false }` rather than rejecting the batch —
 * the caller decides how to surface partial failure. `limit` is clamped to `[1, items.length]`.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const results = new Array<PoolResult<R>>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  // One shared iterator pulled by every lane. `.next()` is synchronous and JS is single-threaded, so
  // no two lanes ever receive the same entry — the classic lock-free worker-pool idiom. Iterating it
  // (rather than an index) also yields `item` as `T`, sidestepping noUncheckedIndexedAccess's `T | undefined`.
  const entries = items.entries();

  const lane = async (): Promise<void> => {
    for (const [index, item] of entries) {
      try {
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, lane));
  return results;
}

/** Tuning for {@link withRetry}. Defaults suit Apple's API: a few attempts, sub-second base, hard cap. */
export interface RetryOptions {
  /** Total attempts including the first try. Defaults to 4. */
  attempts?: number;
  /** Base backoff in ms; attempt N waits `baseMs * 2^(N-1)`, capped at {@link RetryOptions.maxDelayMs}. Defaults to 500. */
  baseMs?: number;
  /** Upper bound on a single backoff wait in ms. Defaults to 8000. */
  maxDelayMs?: number;
  /** Whether an error is worth retrying (e.g. HTTP 429/5xx). Non-retryable errors rethrow immediately. */
  isRetryable: (error: unknown) => boolean;
  /** Sleep implementation; overridable so tests run without real timers. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

/** Resolve after `ms` using a real timer. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invoke `fn`, retrying on a retryable error with exponential backoff. Rethrows immediately for a
 * non-retryable error, and rethrows the last error once attempts are exhausted — so the caller always
 * sees Apple's real message, never a generic "gave up".
 */
export async function withRetry<R>(fn: () => Promise<R>, options: RetryOptions): Promise<R> {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !options.isRetryable(error)) throw error;
      await sleep(Math.min(maxDelayMs, baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
