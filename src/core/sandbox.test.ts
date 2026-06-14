import { describe, expect, it, vi } from "vitest";
import type { SandboxTesterResource } from "../apple/ascClient.js";
import { clearPurchaseHistory, listSandboxTesters, type AscSandboxApi } from "./sandbox.js";

/** A stubbed {@link AscSandboxApi}. Provide testers per test; the clear write is a spy. */
function makeApi(testers: SandboxTesterResource[] = [], overrides: Partial<AscSandboxApi> = {}): AscSandboxApi {
  return {
    listSandboxTesters: vi.fn().mockResolvedValue(testers),
    clearSandboxTesterPurchaseHistory: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function tester(overrides: Partial<SandboxTesterResource> = {}): SandboxTesterResource {
  return { id: "t1", acAccountName: "tester1@sandbox.com", ...overrides };
}

describe("listSandboxTesters", () => {
  it("returns the account's testers", async () => {
    const api = makeApi([tester(), tester({ id: "t2", acAccountName: "tester2@sandbox.com" })]);
    expect(await listSandboxTesters(api)).toHaveLength(2);
  });
});

describe("clearPurchaseHistory", () => {
  it("clears every tester when all is set", async () => {
    const api = makeApi([tester({ id: "t1" }), tester({ id: "t2", acAccountName: "two@sandbox.com" })]);
    const result = await clearPurchaseHistory(api, { emails: [], all: true });
    expect(result.cleared).toHaveLength(2);
    expect(result.notFound).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(["t1", "t2"]);
  });

  it("issues no request when clearing all but there are no testers", async () => {
    const api = makeApi([]);
    const result = await clearPurchaseHistory(api, { emails: [], all: true });
    expect(result.cleared).toEqual([]);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  });

  it("resolves emails to ids (case-insensitive) and batches one request", async () => {
    const api = makeApi([
      tester({ id: "t1", acAccountName: "one@sandbox.com" }),
      tester({ id: "t2", acAccountName: "two@sandbox.com" }),
    ]);
    const result = await clearPurchaseHistory(api, { emails: ["ONE@sandbox.com", "two@sandbox.com"], all: false });
    expect(result.cleared.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(["t1", "t2"]);
  });

  it("reports unmatched emails and de-duplicates repeats", async () => {
    const api = makeApi([tester({ id: "t1", acAccountName: "one@sandbox.com" })]);
    const result = await clearPurchaseHistory(api, {
      emails: ["one@sandbox.com", "one@sandbox.com", "ghost@sandbox.com"],
      all: false,
    });
    expect(result.cleared.map((t) => t.id)).toEqual(["t1"]);
    expect(result.notFound).toEqual(["ghost@sandbox.com"]);
    expect(api.clearSandboxTesterPurchaseHistory).toHaveBeenCalledWith(["t1"]);
  });

  it("issues no request when no email matches", async () => {
    const api = makeApi([tester({ id: "t1", acAccountName: "one@sandbox.com" })]);
    const result = await clearPurchaseHistory(api, { emails: ["ghost@sandbox.com"], all: false });
    expect(result.cleared).toEqual([]);
    expect(result.notFound).toEqual(["ghost@sandbox.com"]);
    expect(api.clearSandboxTesterPurchaseHistory).not.toHaveBeenCalled();
  });

  it("throws when neither emails nor all are given", async () => {
    await expect(clearPurchaseHistory(makeApi(), { emails: ["  "], all: false })).rejects.toThrow(
      /at least one sandbox tester email/,
    );
  });
});
