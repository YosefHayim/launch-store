import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BuildState,
  type FingerprintParts,
  computeBuildFingerprint,
  extractNativeConfigSlice,
  readBuildState,
  resolveClean,
  writeBuildState,
} from "./buildFingerprint.js";

const PARTS: FingerprintParts = {
  podfileLock: "PODS:\n  - Reanimated (4.1.6)\n",
  podfileProperties: '{"newArchEnabled":"true"}',
  appConfigSlice: '{"plugins":["expo-router"],"newArchEnabled":true,"iosDeploymentTarget":"15.1"}',
  toolchainVersion: "Xcode 16.0\nBuild version 16A242d",
};

describe("computeBuildFingerprint — stable hash of the native graph", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeBuildFingerprint(PARTS)).toBe(computeBuildFingerprint({ ...PARTS }));
  });

  it("changes when any single input changes", () => {
    const base = computeBuildFingerprint(PARTS);
    expect(computeBuildFingerprint({ ...PARTS, podfileLock: PARTS.podfileLock + " " })).not.toBe(base);
    expect(computeBuildFingerprint({ ...PARTS, podfileProperties: "{}" })).not.toBe(base);
    expect(computeBuildFingerprint({ ...PARTS, appConfigSlice: "{}" })).not.toBe(base);
    expect(computeBuildFingerprint({ ...PARTS, toolchainVersion: "Xcode 16.1" })).not.toBe(base);
  });

  it("does not alias one field's tail into the next", () => {
    const a = computeBuildFingerprint({ ...PARTS, podfileLock: "ab", podfileProperties: "c" });
    const b = computeBuildFingerprint({ ...PARTS, podfileLock: "a", podfileProperties: "bc" });
    expect(a).not.toBe(b);
  });
});

describe("extractNativeConfigSlice — only native-graph fields count", () => {
  it("pulls plugins, newArchEnabled, and ios.deploymentTarget through the expo wrapper", () => {
    const slice = extractNativeConfigSlice(
      JSON.stringify({ expo: { name: "Demo", plugins: ["expo-router"], newArchEnabled: true, ios: { deploymentTarget: "15.1" } } }),
    );
    expect(JSON.parse(slice)).toEqual({ plugins: ["expo-router"], newArchEnabled: true, iosDeploymentTarget: "15.1" });
  });

  it("ignores JS-only edits (a name change yields the same slice)", () => {
    const a = extractNativeConfigSlice(JSON.stringify({ expo: { name: "Before", plugins: ["x"] } }));
    const b = extractNativeConfigSlice(JSON.stringify({ expo: { name: "After", plugins: ["x"] } }));
    expect(a).toBe(b);
  });

  it("handles a flat (non-wrapped) config shape", () => {
    const slice = extractNativeConfigSlice(JSON.stringify({ plugins: ["a"], newArchEnabled: false }));
    expect(JSON.parse(slice)).toEqual({ plugins: ["a"], newArchEnabled: false, iosDeploymentTarget: null });
  });

  it("falls back to the raw text for a non-JSON dynamic config so any change still invalidates", () => {
    const text = "export default ({ config }) => ({ ...config, plugins: ['x'] });";
    expect(extractNativeConfigSlice(text)).toBe(text);
  });
});

describe("resolveClean — the clean-vs-incremental matrix", () => {
  const stored: BuildState = { fingerprint: "abc", builtAt: "2026-06-14T00:00:00Z", cleanBuilt: true };

  it("forces a clean when --clean is passed, regardless of the fingerprint", () => {
    expect(resolveClean(true, stored, "abc")).toMatchObject({ clean: true, nativeChanged: false });
    expect(resolveClean(true, stored, "xyz")).toMatchObject({ clean: true, nativeChanged: true });
  });

  it("cleans on a first build (no stored state)", () => {
    expect(resolveClean(false, null, "abc")).toMatchObject({ clean: true, nativeChanged: true });
  });

  it("cleans when the fingerprint changed", () => {
    expect(resolveClean(false, stored, "xyz")).toMatchObject({ clean: true, nativeChanged: true });
  });

  it("builds incrementally when the fingerprint matches", () => {
    expect(resolveClean(false, stored, "abc")).toMatchObject({ clean: false, nativeChanged: false });
  });
});

describe("readBuildState / writeBuildState — round-trip through a temp dir", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-fp-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null before anything is written", () => {
    expect(readBuildState("demo", "ios", dir)).toBeNull();
  });

  it("writes then reads back the same state, keyed by app + platform", () => {
    const state: BuildState = { fingerprint: "abc", builtAt: "2026-06-14T00:00:00Z", cleanBuilt: false };
    writeBuildState("demo", "ios", state, dir);
    expect(readBuildState("demo", "ios", dir)).toEqual(state);
    expect(readBuildState("demo", "android", dir)).toBeNull();
    expect(readBuildState("other", "ios", dir)).toBeNull();
  });
});
