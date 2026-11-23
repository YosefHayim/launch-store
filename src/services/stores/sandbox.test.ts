import { describe, expect, it, vi } from 'vitest';
import type { SandboxTesterResource } from '@/types/apple-catalog.js';
import { clearPurchaseHistory, listSandboxTesters, type AscSandboxApi } from './sandbox.ts';

function makeApi(testers: SandboxTesterResource[] = []): AscSandboxApi {
  return {
    listSandboxTesters: vi.fn(async function listTesters() {
      return testers;
    }),
    clearSandboxTesterPurchaseHistory: vi.fn(async function clearHistory() {
      return undefined;
    }),
  };
}

function tester(overrides: Partial<SandboxTesterResource> = {}): SandboxTesterResource {
  return { id: 't1', acAccountName: 'tester1@sandbox.com', ...overrides };
}

function describeListSandboxTesters() {
  async function returnsTheAccountSTesters() {
    const api = makeApi([tester(), tester({ id: 't2', acAccountName: 'tester2@sandbox.com' })]);
    const sandboxTesters = await listSandboxTesters(api);
    expect(sandboxTesters).toHaveLength(2);
  }

  it("returns the account's testers", returnsTheAccountSTesters);
}

describe('listSandboxTesters', describeListSandboxTesters);
describe('clearPurchaseHistory', () => {
  async function clearsEveryTesterWhenAllIsSet() {
    const api = makeApi([
      tester({ id: 't1' }),
      tester({ id: 't2', acAccountName: 'two@sandbox.com' }),
    ]);
    const clearOutcome = await clearPurchaseHistory(api, { emails: [], all: true });

    expect(clearOutcome.cleared).toHaveLength(2);
    expect(clearOutcome.notFound).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1', 't2']);
  }

  it('clears every tester when all is set', clearsEveryTesterWhenAllIsSet);

  async function issuesNoRequestWhenClearingAllButThereAreNoTesters() {
    const api = makeApi([]);
    const clearOutcome = await clearPurchaseHistory(api, { emails: [], all: true });
    expect(clearOutcome.cleared).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  }

  it(
    'issues no request when clearing all but there are no testers',
    issuesNoRequestWhenClearingAllButThereAreNoTesters,
  );
  it('resolves emails to ids (case-insensitive) and batches one request', async () => {
    const api = makeApi([
      tester({ id: 't1', acAccountName: 'one@sandbox.com' }),
      tester({ id: 't2', acAccountName: 'two@sandbox.com' }),
    ]);
    const clearOutcome = await clearPurchaseHistory(api, {
      emails: ['ONE@sandbox.com', 'two@sandbox.com'],
      all: false,
    });

    expect(clearOutcome.cleared.map((testerRecord) => testerRecord.id)).toEqual(['t1', 't2']);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1', 't2']);
  });
  it('reports unmatched emails and de-duplicates repeats', async () => {
    const api = makeApi([tester({ id: 't1', acAccountName: 'one@sandbox.com' })]);
    const clearOutcome = await clearPurchaseHistory(api, {
      emails: ['one@sandbox.com', 'one@sandbox.com', 'ghost@sandbox.com'],
      all: false,
    });

    expect(clearOutcome.cleared.map((testerRecord) => testerRecord.id)).toEqual(['t1']);
    expect(clearOutcome.notFound).toEqual(['ghost@sandbox.com']);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(['t1']);
  });

  async function issuesNoRequestWhenNoEmailMatches() {
    const api = makeApi([tester({ id: 't1', acAccountName: 'one@sandbox.com' })]);
    const clearOutcome = await clearPurchaseHistory(api, {
      emails: ['ghost@sandbox.com'],
      all: false,
    });

    expect(clearOutcome.cleared).toEqual([]);
    expect(clearOutcome.notFound).toEqual(['ghost@sandbox.com']);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  }

  it('issues no request when no email matches', issuesNoRequestWhenNoEmailMatches);

  async function throwsWhenNeitherEmailsNorAllAreGiven() {
    const api = makeApi();

    await expect(clearPurchaseHistory(api, { emails: ['  '], all: false })).rejects.toMatchObject({
      _tag: 'SandboxRequestFailure',
      message: 'Provide at least one sandbox tester email, or pass --all.',
    });
  }

  it('throws when neither emails nor all are given', throwsWhenNeitherEmailsNorAllAreGiven);
});
