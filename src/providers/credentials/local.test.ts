/**
 * Tests for the `local` credentials provider's API-key storage — specifically the base64-at-rest
 * encoding that fixes the macOS `security -w` hex-corruption bug (issue #1). The Keychain backend is
 * mocked with an in-memory map so these run anywhere with no real `security` calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("../../core/keychain.js", () => ({
  setSecret: async (account: string, value: string): Promise<void> => {
    store.set(account, value);
  },
  getSecret: async (account: string): Promise<string | null> => store.get(account) ?? null,
  deleteSecret: async (account: string): Promise<void> => {
    store.delete(account);
  },
}));

import { storeAscKey, loadAscKey } from "./local.js";

/** A realistic multi-line PKCS#8 PEM — the exact shape that triggered the hex-corruption bug. */
const PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgevZzL1gdAFr88hb2",
  "OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r",
  "1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("storeAscKey / loadAscKey", () => {
  beforeEach(() => {
    store.clear();
  });

  it("stores the .p8 as a single line so `security -w` cannot hex-encode it", async () => {
    await storeAscKey("KEY123", "issuer-uuid", PEM);
    const stored = store.get("asc-p8");
    expect(stored).toBeDefined();
    expect(stored).not.toContain("\n");
    expect(stored).not.toBe(PEM);
  });

  it("round-trips a multi-line PEM through store → load unchanged", async () => {
    await storeAscKey("KEY123", "issuer-uuid", PEM);
    const ascKey = await loadAscKey();
    expect(ascKey).toEqual({ keyId: "KEY123", issuerId: "issuer-uuid", p8: PEM });
  });

  it("loads a legacy verbatim PEM (pre-base64) without forcing a re-import", async () => {
    store.set("asc-key-id", "KEY123");
    store.set("asc-issuer-id", "issuer-uuid");
    store.set("asc-p8", PEM); // older builds stored the raw PEM
    const ascKey = await loadAscKey();
    expect(ascKey?.p8).toBe(PEM);
  });

  it("returns null when no key has been imported", async () => {
    expect(await loadAscKey()).toBeNull();
  });
});
