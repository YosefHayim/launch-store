import { describe, expect, it } from "vitest";
import type { LaunchConfig, StorageConfig } from "./types.js";
import { isCloudStorage, resolveStorageProvider } from "./storage.js";
import { registerStorageProvider } from "./registry.js";
import { localStorageProvider } from "../providers/storage/local.js";

/** A LaunchConfig with the given storage settings and otherwise-irrelevant defaults. */
function configWith(storage: string, storageConfig?: StorageConfig): LaunchConfig {
  return {
    profiles: { production: { name: "production" } },
    credentials: "local",
    storage,
    buildEngine: "fastlane",
    submit: "app-store-connect",
    ...(storageConfig ? { storageConfig } : {}),
  };
}

const r2Config: StorageConfig = {
  endpoint: "https://acct.r2.cloudflarestorage.com",
  bucket: "builds",
  publicBaseUrl: "https://cdn.example.com/",
};

describe("resolveStorageProvider", () => {
  it("returns the registered local provider for `local`", () => {
    registerStorageProvider(localStorageProvider);
    expect(resolveStorageProvider(configWith("local")).name).toBe("local");
  });

  it("builds the s3 provider from storageConfig", () => {
    expect(resolveStorageProvider(configWith("s3", r2Config)).name).toBe("s3");
  });

  it("builds the supabase provider when supabaseUrl is present", () => {
    const provider = resolveStorageProvider(
      configWith("supabase", {
        bucket: "builds",
        publicBaseUrl: "https://x.supabase.co/p",
        supabaseUrl: "https://x.supabase.co",
      }),
    );
    expect(provider.name).toBe("supabase");
  });

  it("throws a clear error when a cloud provider is named without a storageConfig block", () => {
    expect(() => resolveStorageProvider(configWith("s3"))).toThrow(/needs a `storageConfig` block/);
  });

  it("throws when supabase is selected without supabaseUrl", () => {
    expect(() => resolveStorageProvider(configWith("supabase", r2Config))).toThrow(/supabaseUrl/);
  });
});

describe("isCloudStorage", () => {
  it("is false for local, true for cloud providers", () => {
    expect(isCloudStorage(configWith("local"))).toBe(false);
    expect(isCloudStorage(configWith("s3", r2Config))).toBe(true);
  });
});

describe("s3 publicUrl", () => {
  it("joins the public base URL and key with a single slash, ignoring stray slashes", () => {
    const provider = resolveStorageProvider(configWith("s3", r2Config));
    expect(provider.publicUrl("apps/hello/manifest.json")).toBe("https://cdn.example.com/apps/hello/manifest.json");
    expect(provider.publicUrl("/leading")).toBe("https://cdn.example.com/leading");
  });
});
