import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./accounts.js", () => ({ loadActiveAscKey: vi.fn() }));
vi.mock("../google/credentials.js", () => ({ loadServiceAccount: vi.fn() }));
vi.mock("../apple/ascClient.js", () => ({ AppStoreConnectClient: vi.fn() }));
vi.mock("../google/playClient.js", () => ({
  GooglePlayClient: vi.fn(),
  parseServiceAccount: vi.fn((json: string) => json),
}));

import { createAscClientResolver, createPlayClientResolver } from "./storeClients.js";
import { loadActiveAscKey } from "./accounts.js";
import { loadServiceAccount } from "../google/credentials.js";
import { AppStoreConnectClient } from "../apple/ascClient.js";
import { GooglePlayClient } from "../google/playClient.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAscClientResolver", () => {
  it("loads credentials and constructs the client once, then memoizes it", async () => {
    vi.mocked(loadActiveAscKey).mockResolvedValue({ keyId: "K", issuerId: "I", p8: "pem" });
    const resolve = createAscClientResolver();
    const first = await resolve();
    const second = await resolve();
    expect(first).toBe(second);
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(AppStoreConnectClient).toHaveBeenCalledTimes(1);
  });

  it("caches a null (unconfigured) result without re-reading or constructing", async () => {
    vi.mocked(loadActiveAscKey).mockResolvedValue(null);
    const resolve = createAscClientResolver();
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(loadActiveAscKey).toHaveBeenCalledTimes(1);
    expect(AppStoreConnectClient).not.toHaveBeenCalled();
  });
});

describe("createPlayClientResolver", () => {
  it("loads the service account and constructs the client once, then memoizes it", async () => {
    vi.mocked(loadServiceAccount).mockResolvedValue("{}");
    const resolve = createPlayClientResolver();
    const first = await resolve();
    const second = await resolve();
    expect(first).toBe(second);
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(GooglePlayClient).toHaveBeenCalledTimes(1);
  });

  it("caches a null result", async () => {
    vi.mocked(loadServiceAccount).mockResolvedValue(null);
    const resolve = createPlayClientResolver();
    expect(await resolve()).toBeNull();
    expect(await resolve()).toBeNull();
    expect(loadServiceAccount).toHaveBeenCalledTimes(1);
    expect(GooglePlayClient).not.toHaveBeenCalled();
  });
});
