import { describe, expect, it } from "vitest";
import type { MerchantIdResource, PassTypeIdResource } from "../apple/ascClient.js";
import {
  type AscWalletApi,
  type WalletConfig,
  parseWalletConfig,
  reconcileWalletIds,
  summarizeWallet,
} from "./walletIds.js";

/** A hand-rolled {@link AscWalletApi} — no network — serving `existing` and recording creates. */
function makeApi(existing: { merchantIds?: MerchantIdResource[]; passTypeIds?: PassTypeIdResource[] }): {
  api: AscWalletApi;
  created: { merchant: string[]; passType: string[] };
} {
  const created = { merchant: [] as string[], passType: [] as string[] };
  const api: AscWalletApi = {
    listMerchantIds: () => Promise.resolve(existing.merchantIds ?? []),
    createMerchantId: (identifier) => {
      created.merchant.push(identifier);
      return Promise.resolve();
    },
    listPassTypeIds: () => Promise.resolve(existing.passTypeIds ?? []),
    createPassTypeId: (identifier) => {
      created.passType.push(identifier);
      return Promise.resolve();
    },
  };
  return { api, created };
}

const CONFIG: WalletConfig = {
  merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme Pay" }],
  passTypeIds: [
    { identifier: "pass.com.acme.coupon", name: "Acme Coupon" },
    { identifier: "pass.com.acme.ticket", name: "Acme Ticket" },
  ],
};

describe("parseWalletConfig", () => {
  it("parses both identifier families", () => {
    expect(parseWalletConfig(CONFIG)).toEqual(CONFIG);
  });

  it("accepts a config with only one family", () => {
    expect(parseWalletConfig({ merchantIds: [{ identifier: "merchant.x", name: "X" }] })).toEqual({
      merchantIds: [{ identifier: "merchant.x", name: "X" }],
    });
  });

  it("rejects a non-object, a family that isn't an array, and a file declaring neither family", () => {
    expect(() => parseWalletConfig("nope")).toThrow(/must be a JSON object/);
    expect(() => parseWalletConfig([])).toThrow(/must be a JSON object/);
    expect(() => parseWalletConfig({})).toThrow(/at least one entry/);
    expect(() => parseWalletConfig({ merchantIds: [], passTypeIds: [] })).toThrow(/at least one entry/);
    expect(() => parseWalletConfig({ merchantIds: {} })).toThrow(/merchantIds must be an array/);
  });

  it("rejects an entry missing identifier or name", () => {
    expect(() => parseWalletConfig({ passTypeIds: [{ name: "X" }] })).toThrow(/identifier must be a non-empty/);
    expect(() => parseWalletConfig({ passTypeIds: [{ identifier: "pass.x" }] })).toThrow(/name must be a non-empty/);
  });
});

describe("reconcileWalletIds", () => {
  it("registers only the identifiers Apple doesn't already have, across both families", async () => {
    const { api, created } = makeApi({
      merchantIds: [{ id: "m1", identifier: "merchant.com.acme.app" }],
      passTypeIds: [{ id: "p1", identifier: "pass.com.acme.coupon" }],
    });
    const actions = await reconcileWalletIds(api, CONFIG, false);

    expect(created.merchant).toEqual([]);
    expect(created.passType).toEqual(["pass.com.acme.ticket"]);
    expect(summarizeWallet(actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(actions[0]?.description).toBe("register Wallet pass type id pass.com.acme.ticket (Acme Ticket)");
  });

  it("registers everything when nothing exists yet", async () => {
    const { api, created } = makeApi({});
    const actions = await reconcileWalletIds(api, CONFIG, false);
    expect(created.merchant).toEqual(["merchant.com.acme.app"]);
    expect(created.passType).toEqual(["pass.com.acme.coupon", "pass.com.acme.ticket"]);
    expect(summarizeWallet(actions)).toEqual({ applied: 3, failed: 0, skipped: 0 });
  });

  it("skips the read for a family the config omits", async () => {
    let merchantListed = false;
    const { api } = makeApi({});
    api.listMerchantIds = () => {
      merchantListed = true;
      return Promise.resolve([]);
    };
    await reconcileWalletIds(api, { passTypeIds: [{ identifier: "pass.x", name: "X" }] }, false);
    expect(merchantListed).toBe(false);
  });

  it("plans but does not register on a dry-run", async () => {
    const { api, created } = makeApi({});
    const actions = await reconcileWalletIds(api, CONFIG, true);
    expect(created.merchant).toHaveLength(0);
    expect(created.passType).toHaveLength(0);
    expect(actions.every((action) => action.status === "planned")).toBe(true);
    expect(actions).toHaveLength(3);
  });

  it("captures a failed registration without aborting the rest", async () => {
    const { api } = makeApi({});
    api.createPassTypeId = (identifier) =>
      identifier === "pass.com.acme.coupon" ? Promise.reject(new Error("already taken")) : Promise.resolve();
    const actions = await reconcileWalletIds(api, CONFIG, false);

    const summary = summarizeWallet(actions);
    expect(summary).toEqual({ applied: 2, failed: 1, skipped: 0 });
    expect(actions.find((action) => action.status === "failed")?.error).toBe("already taken");
  });
});
