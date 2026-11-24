import { describe, expect, it } from 'vitest';
import type { MerchantIdResource, PassTypeIdResource } from '../types/apple/provisioning.ts';
import { summarize } from '../store/shared/reconcile.ts';
import { type AscWalletApi, parseWalletConfig, reconcileWalletIds } from './wallet-ids.ts';
import type { WalletConfig } from '../types/store-surface.ts';
import type { ActionStatus } from '../types/reconcile.ts';

/** A hand-rolled {@link AscWalletApi} - no network - serving `existing` and recording creates. */
function makeApi(existing: {
  merchantIds?: MerchantIdResource[];
  passTypeIds?: PassTypeIdResource[];
}): {
  api: AscWalletApi;
  created: {
    merchant: string[];
    passType: string[];
  };
} {
  const created: { merchant: string[]; passType: string[] } = { merchant: [], passType: [] };
  const api: AscWalletApi = {
    listMerchantIds() {
      if (existing.merchantIds == null) return Promise.resolve([]);

      return Promise.resolve(existing.merchantIds);
    },
    createMerchantId(identifier) {
      created.merchant.push(identifier);
      return Promise.resolve();
    },
    listPassTypeIds() {
      if (existing.passTypeIds == null) return Promise.resolve([]);

      return Promise.resolve(existing.passTypeIds);
    },
    createPassTypeId(identifier) {
      created.passType.push(identifier);
      return Promise.resolve();
    },
  };

  return { api, created };
}

/** Execute the Wallet reconciler at the test boundary. */
function runReconcile(api: AscWalletApi, config: WalletConfig, dryRun: boolean) {
  return reconcileWalletIds(api, config, dryRun);
}
const CONFIG: WalletConfig = {
  merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme Pay' }],
  passTypeIds: [
    { identifier: 'pass.com.acme.coupon', name: 'Acme Coupon' },
    { identifier: 'pass.com.acme.ticket', name: 'Acme Ticket' },
  ],
};

function decodeWalletConfig(rawDocument: unknown) {
  return parseWalletConfig(rawDocument);
}

function describeParseWalletPiece() {
  function parsesBothIdentifierFamilies() {
    const decodeWallet = decodeWalletConfig(CONFIG);
    expect(decodeWallet).toEqual(CONFIG);
  }

  it('parses both identifier families', parsesBothIdentifierFamilies);

  function acceptsAPieceWithOnlyOneFamily() {
    const decodeWallet = decodeWalletConfig({
      merchantIds: [{ identifier: 'merchant.x', name: 'X' }],
    });

    expect(decodeWallet).toEqual({
      merchantIds: [{ identifier: 'merchant.x', name: 'X' }],
    });
  }

  it('accepts a config with only one family', acceptsAPieceWithOnlyOneFamily);

  function rejectsANonObjectAFamilyThatIsnTAnArrayAndAFileDeclaringNeitherFamily() {
    function callDecodeWalletPiece() {
      return decodeWalletConfig('nope');
    }

    expect(callDecodeWalletPiece).toThrow(/must be a JSON object/);

    function callDecodeWalletPiece2() {
      return decodeWalletConfig([]);
    }

    expect(callDecodeWalletPiece2).toThrow(/must be a JSON object/);

    function callDecodeWalletPiece3() {
      return decodeWalletConfig({});
    }

    expect(callDecodeWalletPiece3).toThrow(/at least one entry/);

    function callDecodeWalletPiece4() {
      return decodeWalletConfig({ merchantIds: [], passTypeIds: [] });
    }

    expect(callDecodeWalletPiece4).toThrow(/at least one entry/);

    function callDecodeWalletPiece5() {
      return decodeWalletConfig({ merchantIds: {} });
    }

    expect(callDecodeWalletPiece5).toThrow(/merchantIds/);
  }

  it(
    "rejects a non-object, a family that isn't an array, and a file declaring neither family",
    rejectsANonObjectAFamilyThatIsnTAnArrayAndAFileDeclaringNeitherFamily,
  );

  function rejectsAnPieceMissingIdentifierOrName() {
    function callDecodeWalletPiece6() {
      return decodeWalletConfig({ passTypeIds: [{ name: 'X' }] });
    }

    expect(callDecodeWalletPiece6).toThrow(/identifier/);

    function callDecodeWalletPiece7() {
      return decodeWalletConfig({ passTypeIds: [{ identifier: 'pass.x' }] });
    }

    expect(callDecodeWalletPiece7).toThrow(/name/);
  }

  it('rejects an entry missing identifier or name', rejectsAnPieceMissingIdentifierOrName);
}

describe('parseWalletConfig', describeParseWalletPiece);

function describeReconcileWalletIds() {
  async function registersOnlyTheIdentifiersAppleDoesnTAlreadyHaveAcrossBothFamilies() {
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
  }

  it(
    "registers only the identifiers Apple doesn't already have, across both families",
    registersOnlyTheIdentifiersAppleDoesnTAlreadyHaveAcrossBothFamilies,
  );

  async function registersEverythingWhenNothingExistsYet() {
    const { api, created } = makeApi({});
    const actions = await runReconcile(api, CONFIG, false);

    expect(created.merchant).toEqual(['merchant.com.acme.app']);
    expect(created.passType).toEqual(['pass.com.acme.coupon', 'pass.com.acme.ticket']);
    expect(summarize(actions)).toEqual({ applied: 3, failed: 0, skipped: 0 });
  }

  it('registers everything when nothing exists yet', registersEverythingWhenNothingExistsYet);

  async function skipsTheReadForAFamilyThePieceOmits() {
    let merchantListed = false;
    const { api } = makeApi({});

    function runPiece() {
      merchantListed = true;
      return Promise.resolve([]);
    }

    api.listMerchantIds = runPiece;
    await runReconcile(api, { passTypeIds: [{ identifier: 'pass.x', name: 'X' }] }, false);
    expect(merchantListed).toBe(false);
  }

  it('skips the read for a family the config omits', skipsTheReadForAFamilyThePieceOmits);

  async function plansButDoesNotRegisterOnADryRun() {
    const { api, created } = makeApi({});
    const actions = await runReconcile(api, CONFIG, true);

    expect(created.merchant).toHaveLength(0);
    expect(created.passType).toHaveLength(0);

    function isPlannedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'planned';
    }

    expect(actions.every(isPlannedAction)).toBe(true);
    expect(actions).toHaveLength(3);
  }

  it('plans but does not register on a dry-run', plansButDoesNotRegisterOnADryRun);

  async function capturesAFailedRegistrationWithoutAbortingTheRest() {
    const { api } = makeApi({});

    function runIdentifier(identifier: string) {
      if (identifier == 'pass.com.acme.coupon') {
        return Promise.reject(new Error('already taken'));
      }

      return Promise.resolve();
    }

    api.createPassTypeId = runIdentifier;

    const actions = await runReconcile(api, CONFIG, false);
    const summary = summarize(actions);

    expect(summary).toEqual({ applied: 2, failed: 1, skipped: 0 });

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    expect(actions.find(isFailedAction)?.error).toBe('already taken');
  }

  it(
    'captures a failed registration without aborting the rest',
    capturesAFailedRegistrationWithoutAbortingTheRest,
  );
}

describe('reconcileWalletIds', describeReconcileWalletIds);
