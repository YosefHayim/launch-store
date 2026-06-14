import { describe, expect, it, vi } from "vitest";
import { runPool, withRetry } from "./asyncPool.js";

describe("runPool", () => {
  it("preserves input order in the results regardless of completion order", async () => {
    const results = await runPool([30, 10, 20], 3, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return i;
    });
    expect(results).toEqual([
      { ok: true, value: 0 },
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("isolates a failing item instead of rejecting the whole batch", async () => {
    const results = await runPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n * 10;
    });
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1]).toMatchObject({ ok: false });
    expect(results[1]).toMatchObject({ error: expect.objectContaining({ message: "boom" }) });
    expect(results[2]).toEqual({ ok: true, value: 30 });
  });

  it("clamps a too-large limit and handles an empty list", async () => {
    expect(await runPool([], 8, async () => 1)).toEqual([]);
    const results = await runPool([1, 2], 99, async (n) => n);
    expect(results).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  });
});

describe("withRetry", () => {
  it("returns immediately when the first attempt succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await withRetry(fn, { isRetryable: () => true, sleep })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a retryable error with exponential backoff, then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue("done");
    const waits: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      waits.push(ms);
    });
    const result = await withRetry(fn, { isRetryable: () => true, baseMs: 100, sleep });
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([100, 200]);
  });

  it("rethrows a non-retryable error without sleeping", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("403"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { isRetryable: () => false, sleep })).rejects.toThrow("403");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the attempt budget and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still 429"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withRetry(fn, { attempts: 3, isRetryable: () => true, sleep })).rejects.toThrow("still 429");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("caps the backoff at maxDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429"));
    const waits: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      waits.push(ms);
    });
    await expect(
      withRetry(fn, { attempts: 5, baseMs: 1000, maxDelayMs: 2000, isRetryable: () => true, sleep }),
    ).rejects.toThrow();
    expect(waits).toEqual([1000, 2000, 2000, 2000]);
  });
});
