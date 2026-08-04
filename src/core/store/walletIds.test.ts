import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { MerchantIdResource, PassTypeIdResource } from '../types/appleCatalog.js';
import { summarize } from './reconcile.js';
import { type AscWalletApi, parseWalletConfig, reconcileWalletIds } from './walletIds.js';
import type { WalletConfig } from '../types/storeSurface.js';
/** A hand-rolled {@link AscWalletApi} - no network - serving `existing` and recording creates. */
const makeApi = (existing: {
  merchantIds?: MerchantIdResource[];
  passTypeIds?: PassTypeIdResource[];
}): {
  api: AscWalletApi;
  created: {
    merchant: string[];
    passType: string[];
  };
} => {
  const created: { merchant: string[]; passType: string[] } = { merchant: [], passType: [] };
  const api: AscWalletApi = {
    listMerchantIds: () => {
      if (existing.merchantIds === undefined) return Effect.succeed([]);
      return Effect.succeed(existing.merchantIds);
    },
    createMerchantId: (identifier) => {
      created.merchant.push(identifier);
      return Effect.void;
    },
    listPassTypeIds: () => {
      if (existing.passTypeIds === undefined) return Effect.succeed([]);
      return Effect.succeed(existing.passTypeIds);
    },
    createPassTypeId: (identifier) => {
      created.passType.push(identifier);
      return Effect.void;
    },
  };
  return { api, created };
};
/** Execute the Wallet reconciler at the test boundary. */
const runReconcile = (api: AscWalletApi, config: WalletConfig, dryRun: boolean) =>
  Effect.runPromise(reconcileWalletIds(api, config, dryRun));
const CONFIG: WalletConfig = {
  merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
  passTypeIds: [
    { identifier: 'pass.com.acme.coupon', name: 'Acme Coupon' },
    { identifier: 'pass.com.acme.ticket', name: 'Acme Ticket' },
  ],
};
const decodeWalletConfig = (rawDocument: unknown) => Effect.runSync(parseWalletConfig(rawDocument));
describe('parseWalletConfig', () => {
  it('parses both identifier families', () => {
    expect(decodeWalletConfig(CONFIG)).toEqual(CONFIG);
  });
  it('accepts a config with only one family', () => {
    expect(decodeWalletConfig({ merchantIds: [{ identifier: 'merchant.x', name: 'X' }] })).toEqual({
      merchantIds: [{ identifier: 'merchant.x', name: 'X' }],
    });
  });
  it("rejects a non-object, a family that isn't an array, and a file declaring neither family", () => {
    expect(() => decodeWalletConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => decodeWalletConfig([])).toThrow(/must be a JSON object/);
    expect(() => decodeWalletConfig({})).toThrow(/at least one entry/);
    expect(() => decodeWalletConfig({ merchantIds: [], passTypeIds: [] })).toThrow(
      /at least one entry/,
    );
    expect(() => decodeWalletConfig({ merchantIds: {} })).toThrow(/merchantIds/);
  });
  it('rejects an entry missing identifier or name', () => {
    expect(() => decodeWalletConfig({ passTypeIds: [{ name: 'X' }] })).toThrow(/identifier/);
    expect(() => decodeWalletConfig({ passTypeIds: [{ identifier: 'pass.x' }] })).toThrow(/name/);
  });
});
describe('reconcileWalletIds', () => {
  it("registers only the identifiers Apple doesn't already have, across both families", async () => {
    const { api, created } = makeApi({
      merchantIds: [{ id: 'm1', identifier: 'merchant.com.acme.app' }],
      passTypeIds: [{ id: 'p1', identifier: 'pass.com.acme.coupon' }],
    });
    const actions = await runReconcile(api, CONFIG, false);
    expect(created.merchant).toEqual([]);
    expect(created.passType).toEqual(['pass.com.acme.ticket']);
    expect(summarize(actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(actions[0]?.description).toBe(
      'register Wallet pass type id pass.com.acme.ticket (Acme Ticket)',
    );
  });
  it('registers everything when nothing exists yet', async () => {
    const { api, created } = makeApi({});
    const actions = await runReconcile(api, CONFIG, false);
    expect(created.merchant).toEqual(['merchant.com.acme.app']);
    expect(created.passType).toEqual(['pass.com.acme.coupon', 'pass.com.acme.ticket']);
    expect(summarize(actions)).toEqual({ applied: 3, failed: 0, skipped: 0 });
  });
  it('skips the read for a family the config omits', async () => {
    let merchantListed = false;
    const { api } = makeApi({});
    api.listMerchantIds = () => {
      merchantListed = true;
      return Effect.succeed([]);
    };
    await runReconcile(api, { passTypeIds: [{ identifier: 'pass.x', name: 'X' }] }, false);
    expect(merchantListed).toBe(false);
  });
  it('plans but does not register on a dry-run', async () => {
    const { api, created } = makeApi({});
    const actions = await runReconcile(api, CONFIG, true);
    expect(created.merchant).toHaveLength(0);
    expect(created.passType).toHaveLength(0);
    expect(actions.every((action) => action.status === 'planned')).toBe(true);
    expect(actions).toHaveLength(3);
  });
  it('captures a failed registration without aborting the rest', async () => {
    const { api } = makeApi({});
    api.createPassTypeId = (identifier) => {
      if (identifier === 'pass.com.acme.coupon') {
        return Effect.fail(new Error('already taken'));
      }
      return Effect.void;
    };
    const actions = await runReconcile(api, CONFIG, false);
    const summary = summarize(actions);
    expect(summary).toEqual({ applied: 2, failed: 1, skipped: 0 });
    expect(actions.find((action) => action.status === 'failed')?.error).toBe('already taken');
  });
});
