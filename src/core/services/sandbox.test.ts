import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { SandboxTesterResource } from '../types/appleCatalog.js';
import { clearPurchaseHistory, listSandboxTesters, type AscSandboxApi } from './sandbox.js';
/** A stubbed {@link AscSandboxApi}. Provide testers per test; the clear write is a spy. */
const makeApi = (
  testers: SandboxTesterResource[] = [],
  overrides: Partial<AscSandboxApi> = {},
): AscSandboxApi => {
  return {
    listSandboxTesters: vi.fn(() => Effect.succeed(testers)),
    clearSandboxTesterPurchaseHistory: vi.fn(() => Effect.void),
    ...overrides,
  };
};
const tester = (overrides: Partial<SandboxTesterResource> = {}): SandboxTesterResource => {
  return { id: 't1', acAccountName: 'tester1@sandbox.com', ...overrides };
};
describe('listSandboxTesters', () => {
  it("returns the account's testers", async () => {
    const api = makeApi([tester(), tester({ id: 't2', acAccountName: 'tester2@sandbox.com' })]);
    expect(await Effect.runPromise(listSandboxTesters(api))).toHaveLength(2);
  });
});
describe('clearPurchaseHistory', () => {
  it('clears every tester when all is set', async () => {
    const api = makeApi([
      tester({ id: 't1' }),
      tester({ id: 't2', acAccountName: 'two@sandbox.com' }),
    ]);
    const clearOutcome = await Effect.runPromise(
      clearPurchaseHistory(api, { emails: [], all: true }),
    );
    expect(clearOutcome.cleared).toHaveLength(2);
    expect(clearOutcome.notFound).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1', 't2']);
  });
  it('issues no request when clearing all but there are no testers', async () => {
    const api = makeApi([]);
    const clearOutcome = await Effect.runPromise(
      clearPurchaseHistory(api, { emails: [], all: true }),
    );
    expect(clearOutcome.cleared).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  });
  it('resolves emails to ids (case-insensitive) and batches one request', async () => {
    const api = makeApi([
      tester({ id: 't1', acAccountName: 'one@sandbox.com' }),
      tester({ id: 't2', acAccountName: 'two@sandbox.com' }),
    ]);
    const clearOutcome = await Effect.runPromise(
      clearPurchaseHistory(api, {
        emails: ['ONE@sandbox.com', 'two@sandbox.com'],
        all: false,
      }),
    );
    expect(clearOutcome.cleared.map((testerRecord) => testerRecord.id)).toEqual(['t1', 't2']);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1', 't2']);
  });
  it('reports unmatched emails and de-duplicates repeats', async () => {
    const api = makeApi([tester({ id: 't1', acAccountName: 'one@sandbox.com' })]);
    const clearOutcome = await Effect.runPromise(
      clearPurchaseHistory(api, {
        emails: ['one@sandbox.com', 'one@sandbox.com', 'ghost@sandbox.com'],
        all: false,
      }),
    );
    expect(clearOutcome.cleared.map((testerRecord) => testerRecord.id)).toEqual(['t1']);
    expect(clearOutcome.notFound).toEqual(['ghost@sandbox.com']);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1']);
  });
  it('issues no request when no email matches', async () => {
    const api = makeApi([tester({ id: 't1', acAccountName: 'one@sandbox.com' })]);
    const clearOutcome = await Effect.runPromise(
      clearPurchaseHistory(api, { emails: ['ghost@sandbox.com'], all: false }),
    );
    expect(clearOutcome.cleared).toEqual([]);
    expect(clearOutcome.notFound).toEqual(['ghost@sandbox.com']);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  });
  it('throws when neither emails nor all are given', async () => {
    await expect(
      Effect.runPromise(clearPurchaseHistory(makeApi(), { emails: ['  '], all: false })),
    ).rejects.toThrow(/at least one sandbox tester email/);
  });
});
