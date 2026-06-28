import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessProbe, ProbeResult } from '../../core/readiness/types.js';
import { READINESS_EXIT } from '../../core/readiness/orchestrator.js';

/**
 * The category passed to the last `selectReadinessProbes` call, captured so a test can assert that a
 * command's probe slice reaches the registry unchanged. Mutated by the mock below.
 */
let selectedCategory: string | undefined;

/** A fake probe that returns a fixed result with no network — same idiom as `orchestrator.test.ts`. */
function probe(id: string, result: ProbeResult): ReadinessProbe {
  return { id, title: id, store: 'appstore', categories: ['submit'], check: async () => result };
}

/** The probe slice the mocked registry hands back; swapped per test to drive the outcome. */
let probes: ReadinessProbe[] = [];

vi.mock('../../core/config.js', () => ({
  loadConfig: async () => ({ config: {}, apps: [] }),
}));

vi.mock('../../core/storeClients.js', () => ({
  createAscClientResolver: () => async () => undefined,
  createPlayClientResolver: () => async () => undefined,
}));

vi.mock('../../core/readiness/registry.js', () => ({
  registerBuiltinProbes: () => {},
  selectReadinessProbes: (category: string) => {
    selectedCategory = category;
    return probes;
  },
}));

const { runReadinessCommand } = await import('./readinessReport.js');

const LABELS = { summary: 'Test readiness', empty: 'No checks ran.' };

describe('runReadinessCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    probes = [];
    selectedCategory = undefined;
  });

  it('passes its category through to the probe selector', async () => {
    probes = [];
    await runReadinessCommand({ category: 'iap', labels: LABELS });
    expect(selectedCategory).toBe('iap');
  });

  it('sets exit code 0 when every probe is clear', async () => {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runReadinessCommand({ category: 'submit', labels: LABELS });
    expect(process.exitCode).toBe(READINESS_EXIT.ok);
  });

  it('sets exit code 2 when a probe reports a blocker', async () => {
    probes = [
      probe('blocked', {
        state: 'checked',
        apps: [{ app: 'y', identifier: 'com.y', status: 'blocker', detail: 'missing' }],
      }),
    ];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runReadinessCommand({ category: 'account', labels: LABELS });
    expect(process.exitCode).toBe(READINESS_EXIT.blocker);
  });

  it('emits the raw outcome as JSON under --json', async () => {
    probes = [
      probe('clear', {
        state: 'checked',
        apps: [{ app: 'x', identifier: 'com.x', status: 'ok', detail: 'ready' }],
      }),
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runReadinessCommand({ category: 'submit', labels: LABELS, json: true });

    expect(log).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(printed.exitCode).toBe(READINESS_EXIT.ok);
    expect(printed.reports).toHaveLength(1);
  });
});
