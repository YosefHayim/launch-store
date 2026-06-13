/**
 * Tests for Android credential storage — the base64-at-rest encoding of the service-account JSON
 * (the same macOS `security -w` hex-corruption fix as the iOS `.p8`) and the status summary. The
 * secret store is mocked with an in-memory map so these run anywhere with no real keychain calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("../core/keychain.js", () => ({
  setSecret: async (account: string, value: string): Promise<void> => {
    store.set(account, value);
  },
  getSecret: async (account: string): Promise<string | null> => store.get(account) ?? null,
  deleteSecret: async (account: string): Promise<void> => {
    store.delete(account);
  },
}));

import { describeStoredAndroidCredentials, loadServiceAccount, storeServiceAccount } from "./credentials.js";

/** A valid-shaped service-account key (multi-line PEM is the exact case that triggered the hex bug). */
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  client_email: "launch@proj.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\nkqhkiG9w0BAQ\n-----END PRIVATE KEY-----\n",
  token_uri: "https://oauth2.googleapis.com/token",
});

beforeEach(() => {
  store.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("storeServiceAccount / loadServiceAccount", () => {
  it("stores the JSON as a single base64 line so `security -w` cannot hex-encode it", async () => {
    await storeServiceAccount(SERVICE_ACCOUNT);
    const stored = store.get("play-service-account");
    expect(stored).toBeDefined();
    expect(stored).not.toContain("\n");
    expect(stored).not.toBe(SERVICE_ACCOUNT);
  });

  it("round-trips a multi-line key through store → load unchanged", async () => {
    await storeServiceAccount(SERVICE_ACCOUNT);
    expect(await loadServiceAccount()).toBe(SERVICE_ACCOUNT);
  });

  it("validates the key shape before storing anything", async () => {
    await expect(storeServiceAccount(JSON.stringify({ type: "authorized_user" }))).rejects.toThrow(
      /client_email.*private_key/,
    );
    expect(store.size).toBe(0);
  });

  it("returns null when no service account has been imported", async () => {
    expect(await loadServiceAccount()).toBeNull();
  });
});

describe("describeStoredAndroidCredentials", () => {
  it("reports nothing cached on a fresh machine", async () => {
    expect(await describeStoredAndroidCredentials()).toEqual({ keystoreAlias: null, hasServiceAccount: false });
  });

  it("reports the service account once imported", async () => {
    await storeServiceAccount(SERVICE_ACCOUNT);
    const { hasServiceAccount } = await describeStoredAndroidCredentials();
    expect(hasServiceAccount).toBe(true);
  });
});
