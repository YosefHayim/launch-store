import { describe, expect, it } from "vitest";
import type { StorageProvider } from "./types.js";
import { getStorageProvider, registerStorageProvider } from "./registry.js";

/** A throwaway storage provider for exercising the registry without touching disk. */
function fakeStorage(name: string): StorageProvider {
  return {
    name,
    put: () => Promise.reject(new Error("not used")),
    list: () => Promise.resolve([]),
    url: () => Promise.resolve(""),
  };
}

describe("provider registry — the DI seam", () => {
  it("registers a provider and looks it up by name", () => {
    const provider = fakeStorage("memory");
    registerStorageProvider(provider);
    expect(getStorageProvider("memory")).toBe(provider);
  });

  it("throws a clear error naming the available providers when one is missing", () => {
    registerStorageProvider(fakeStorage("local"));
    expect(() => getStorageProvider("s3")).toThrow(/Unknown storage provider "s3"\. Available: .*local/);
  });
});
