import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BuildState,
  type FingerprintParts,
  computeBuildFingerprint,
  estimateFor,
  extractNativeConfigSlice,
  readBuildState,
  resolveClean,
  updateEstimate,
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
      JSON.stringify({
        expo: { name: "Demo", plugins: ["expo-router"], newArchEnabled: true, ios: { deploymentTarget: "15.1" } },
      }),
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

  it("round-trips the per-kind estimates the ETA learns from", () => {
    const state: BuildState = {
      fingerprint: "abc",
      builtAt: "2026-06-14T00:00:00Z",
      cleanBuilt: true,
      estimates: { clean: { ms: 214000, steps: 660 }, incremental: { ms: 41000, steps: 28 } },
    };
    writeBuildState("demo", "ios", state, dir);
    expect(readBuildState("demo", "ios", dir)).toEqual(state);
  });
});

describe("updateEstimate — EMA so one freak-slow build only half-skews the next ETA", () => {
  it("adopts the first sample verbatim when there's no prior", () => {
    expect(updateEstimate(undefined, { ms: 41000, steps: 28 })).toEqual({ ms: 41000, steps: 28 });
  });

  it("blends half the new sample with half the prior (default alpha 0.5), rounding", () => {
    // a freak-slow 80s build over a 41s baseline lands at 60.5s → 60500 (rounded), and self-heals next run
    expect(updateEstimate({ ms: 41000, steps: 28 }, { ms: 80000, steps: 40 })).toEqual({ ms: 60500, steps: 34 });
    expect(updateEstimate({ ms: 60500, steps: 34 }, { ms: 40000, steps: 28 })).toEqual({ ms: 50250, steps: 31 });
  });

  it("honors a custom alpha", () => {
    expect(updateEstimate({ ms: 100, steps: 10 }, { ms: 200, steps: 20 }, 0.25)).toEqual({ ms: 125, steps: 13 });
  });
});

describe("estimateFor — pick the baseline matching this build's kind", () => {
  const state: BuildState = {
    fingerprint: "abc",
    builtAt: "2026-06-14T00:00:00Z",
    cleanBuilt: false,
    estimates: { clean: { ms: 214000, steps: 660 }, incremental: { ms: 41000, steps: 28 } },
  };

  it("returns the estimate for a known kind", () => {
    expect(estimateFor(state, "incremental")).toEqual({ ms: 41000, steps: 28 });
  });

  it("returns undefined for an unrecorded kind, no estimates, or null state", () => {
    expect(estimateFor(state, "default")).toBeUndefined();
    expect(estimateFor({ fingerprint: "x", builtAt: "t", cleanBuilt: false }, "clean")).toBeUndefined();
    expect(estimateFor(null, "clean")).toBeUndefined();
  });
});
