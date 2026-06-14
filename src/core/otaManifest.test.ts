import { describe, expect, it } from "vitest";
import {
  assembleManifest,
  assembleRollbackDirective,
  contentTypeFor,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  updatesAppConfigSnippet,
  updatesWorkerScript,
} from "./otaManifest.js";

describe("contentTypeFor", () => {
  it("maps known extensions and defaults unknown ones to octet-stream", () => {
    expect(contentTypeFor("_expo/static/js/ios/index-abc.hbc")).toBe("application/javascript");
    expect(contentTypeFor("assets/logo.png")).toBe("image/png");
    expect(contentTypeFor("fonts/Inter.ttf")).toBe("font/ttf");
    expect(contentTypeFor("weird.xyz")).toBe("application/octet-stream");
  });
});

describe("assembleManifest", () => {
  it("produces a protocol-v0 manifest with empty metadata/extra", () => {
    const manifest = assembleManifest({
      id: "uuid-1",
      createdAt: "2026-06-14T00:00:00.000Z",
      runtimeVersion: "1.0.0",
      launchAsset: { key: "bundle", contentType: "application/javascript", url: "https://cdn/x.hbc" },
      assets: [{ key: "logo", contentType: "image/png", url: "https://cdn/logo", fileExtension: ".png" }],
    });
    expect(manifest).toMatchObject({
      id: "uuid-1",
      runtimeVersion: "1.0.0",
      launchAsset: { url: "https://cdn/x.hbc" },
      metadata: {},
      extra: {},
    });
    expect(manifest.assets[0]?.fileExtension).toBe(".png");
  });
});

describe("manifestKey", () => {
  it("keys a manifest by channel, platform, and runtime version", () => {
    expect(manifestKey("production", "ios", "1.0.0")).toBe("updates/production/ios/1.0.0/manifest.json");
    expect(manifestSignatureKey("production", "ios", "1.0.0")).toBe("updates/production/ios/1.0.0/manifest.sig");
  });
});

describe("history + rollback keys", () => {
  it("keys the index per channel+platform and snapshots/directives under the runtime version", () => {
    expect(historyIndexKey("production", "android")).toBe("updates/production/android/history.json");
    expect(historySnapshotKey("production", "ios", "1.0.0", "abc")).toBe(
      "updates/production/ios/1.0.0/history/abc.json",
    );
    expect(rollbackDirectiveKey("production", "ios", "1.0.0")).toBe("updates/production/ios/1.0.0/rollback.json");
  });
});

describe("assembleRollbackDirective", () => {
  it("builds a rollBackToEmbedded directive committed at the given time", () => {
    expect(assembleRollbackDirective("2026-06-14T00:00:00.000Z")).toEqual({
      type: "rollBackToEmbedded",
      parameters: { commitTime: "2026-06-14T00:00:00.000Z" },
    });
  });
});

describe("updatesWorkerScript", () => {
  it("reads the expo headers and routes to the static manifest under the public base", () => {
    const script = updatesWorkerScript("https://cdn.example.com/");
    expect(script).toContain("expo-runtime-version");
    expect(script).toContain("expo-channel-name");
    expect(script).toContain('"https://cdn.example.com"'); // trailing slash trimmed
    expect(script).toContain("expo-protocol-version");
    expect(script).toContain("manifest.sig");
  });

  it("emits a protocol-v1 multipart response with a rollback directive part", () => {
    const script = updatesWorkerScript("https://cdn.example.com");
    expect(script).toContain("multipart/mixed");
    expect(script).toContain("'expo-protocol-version': '1'");
    expect(script).toContain("rollback.json");
    expect(script).toContain("part('directive'");
    expect(script).toContain("part('manifest'");
  });
});

describe("updatesAppConfigSnippet", () => {
  it("includes the code-signing block only when signed", () => {
    const signed = updatesAppConfigSnippet({ updateUrl: "https://w", runtimeVersion: "1.0.0", signed: true });
    expect(signed).toContain("codeSigningCertificate");
    expect(signed).toContain("rsa-v1_5-sha256");
    const unsigned = updatesAppConfigSnippet({ updateUrl: "https://w", runtimeVersion: "1.0.0", signed: false });
    expect(unsigned).not.toContain("codeSigningCertificate");
  });
});
