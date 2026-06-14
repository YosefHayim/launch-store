import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A dry-run must never shell out; make any spawn an immediate, obvious failure.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    throw new Error("spawn must not run during --dry-run");
  }),
}));

import { registerBuiltins } from "../providers/index.js";
import {
  resolveBumpKind,
  runBuild,
  selectApp,
  sizeSummary,
  uploadSizeReadout,
  worstDownloadBytes,
} from "./pipeline.js";
import type { AppDescriptor, SizeReport } from "./types.js";

registerBuiltins();

/** Any fetch during a dry-run is a bug — the rehearsal makes no account changes. */
const fetchGuard = vi.fn(() => {
  throw new Error("fetch must not run during --dry-run");
});

let originalCwd = "";
let tempRepo = "";

beforeEach(() => {
  originalCwd = process.cwd();
  fetchGuard.mockClear();
  vi.stubGlobal("fetch", fetchGuard);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (tempRepo) {
    rmSync(tempRepo, { recursive: true, force: true });
    tempRepo = "";
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Create a one-app repo (no launch.config.ts, so loadConfig uses defaults — no jiti, fully hermetic). */
function writeRepo(expo: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-pipeline-"));
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo }));
  return dir;
}

describe("runBuild --dry-run (the end-to-end spine)", () => {
  it("rehearses every iOS step with no network and no spawned process", async () => {
    tempRepo = writeRepo({ slug: "hello", version: "1.0.0", ios: { bundleIdentifier: "com.example.hello" } });
    process.chdir(tempRepo);

    await expect(
      runBuild({
        platform: "ios",
        profileName: "production",
        appName: undefined,
        explain: false,
        submit: true,
        target: "testing",
        dryRun: true,
      }),
    ).resolves.toBeUndefined();

    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it("rehearses every Android step with no network and no spawned process", async () => {
    tempRepo = writeRepo({
      slug: "hello",
      version: "1.0.0",
      android: { package: "com.example.hello", versionCode: 3 },
    });
    process.chdir(tempRepo);

    await expect(
      runBuild({
        platform: "android",
        profileName: "production",
        appName: undefined,
        explain: false,
        submit: true,
        target: "testing",
        dryRun: true,
      }),
    ).resolves.toBeUndefined();

    expect(fetchGuard).not.toHaveBeenCalled();
  });
});

describe("selectApp", () => {
  const app = (name: string, bundleId?: string): AppDescriptor => ({
    name,
    dir: "/repo",
    configPath: "/repo/app.json",
    ...(bundleId ? { bundleId } : {}),
  });

  it("fails when no apps were discovered", async () => {
    await expect(selectApp([], undefined)).rejects.toThrow(/No apps found/);
  });

  it("returns the sole app without prompting", async () => {
    const only = app("solo", "com.example.solo");
    expect(await selectApp([only], undefined)).toBe(only);
  });

  it("resolves an explicit --app and errors on a miss", async () => {
    const alpha = app("alpha");
    const beta = app("beta");
    expect(await selectApp([alpha, beta], "beta")).toBe(beta);
    await expect(selectApp([alpha, beta], "gamma")).rejects.toThrow(/App "gamma" not found/);
  });

  it("refuses to guess with multiple apps and no TTY, pointing at --app", async () => {
    // The vitest process has no TTY, so the picker must not hang — it throws an actionable error.
    await expect(selectApp([app("alpha"), app("beta")], undefined)).rejects.toThrow(/--app/);
  });
});

describe("size helpers — the both-numbers headline (F2)", () => {
  const MB = 1024 * 1024;
  const report = (entries: SizeReport["entries"], artifactBytes = 64 * MB): SizeReport => ({ artifactBytes, entries });

  it("worstDownloadBytes picks the largest per-device download", () => {
    const r = report([
      { device: "a", downloadBytes: 40 * MB, installBytes: 0 },
      { device: "b", downloadBytes: 47 * MB, installBytes: 0 },
    ]);
    expect(worstDownloadBytes(r)).toBe(47 * MB);
  });

  it("worstDownloadBytes falls back to the on-disk size with no per-device entries", () => {
    expect(worstDownloadBytes(report([], 61 * MB))).toBe(61 * MB);
  });

  it("sizeSummary shows both numbers when a per-device estimate exists", () => {
    const r = report([{ device: "a", downloadBytes: 47.2 * MB, installBytes: 0 }], 61.3 * MB);
    expect(sizeSummary(r)).toBe("download 47.2 MB · on disk 61.3 MB");
  });

  it("sizeSummary falls back to on-disk alone when there's no per-device estimate", () => {
    expect(sizeSummary(report([], 61.3 * MB))).toBe("on disk 61.3 MB (no per-device estimate)");
  });
});

describe("uploadSizeReadout — pre-upload size lines + growth warning", () => {
  const MB = 1024 * 1024;
  const report = (downloadMB: number, artifactMB = 64): SizeReport => ({
    artifactBytes: artifactMB * MB,
    entries: [{ device: "iphone", downloadBytes: downloadMB * MB, installBytes: 0 }],
  });

  it("shows download + on-disk and no delta on the first build", () => {
    const { lines, grew } = uploadSizeReadout(report(38, 61));
    expect(lines).toEqual(["download 38.0 MB", "on disk 61.0 MB"]);
    expect(grew).toBeNull();
  });

  it("appends a signed delta against the previous build", () => {
    const { lines } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(lines[0]).toBe("download 38.0 MB (+4.2 MB since build 41)");
  });

  it("warns when the download grows more than 10% over the previous build", () => {
    const { grew } = uploadSizeReadout(report(38), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toEqual({ pct: 12, buildNumber: 41 });
  });

  it("does not warn for growth at or under 10%", () => {
    const { grew } = uploadSizeReadout(report(36), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(grew).toBeNull();
  });

  it("shows a negative delta and no warning when the build shrank", () => {
    const { lines, grew } = uploadSizeReadout(report(30), { downloadBytes: 33.8 * MB, buildNumber: 41 });
    expect(lines[0]).toBe("download 30.0 MB (-3.8 MB since build 41)");
    expect(grew).toBeNull();
  });

  it("falls back to on-disk only (no delta) when there's no per-device estimate", () => {
    const readout = uploadSizeReadout(
      { artifactBytes: 61 * MB, entries: [] },
      { downloadBytes: 10 * MB, buildNumber: 1 },
    );
    expect(readout.lines).toEqual(["on disk 61.0 MB (no per-device estimate)"]);
    expect(readout.grew).toBeNull();
  });
});

describe("resolveBumpKind — flag > remembered > prompt precedence", () => {
  it("applies an explicit --bump kind, even non-interactively (scriptable in CI)", () => {
    expect(resolveBumpKind({ flag: "minor", remembered: "patch", canPrompt: true })).toEqual({
      mode: "apply",
      kind: "minor",
      source: "flag",
    });
    expect(resolveBumpKind({ flag: "major", remembered: undefined, canPrompt: false })).toEqual({
      mode: "apply",
      kind: "major",
      source: "flag",
    });
  });

  it("forces the prompt on --bump ask, ignoring a remembered pick", () => {
    expect(resolveBumpKind({ flag: "ask", remembered: "patch", canPrompt: true })).toEqual({ mode: "prompt" });
  });

  it("auto-applies a remembered pick when no flag is given and we can prompt", () => {
    expect(resolveBumpKind({ flag: undefined, remembered: "patch", canPrompt: true })).toEqual({
      mode: "apply",
      kind: "patch",
      source: "remembered",
    });
  });

  it("prompts on a first run (no flag, nothing remembered)", () => {
    expect(resolveBumpKind({ flag: undefined, remembered: undefined, canPrompt: true })).toEqual({ mode: "prompt" });
  });

  it("leaves the config version untouched under --yes/CI with no flag", () => {
    expect(resolveBumpKind({ flag: undefined, remembered: "patch", canPrompt: false })).toEqual({ mode: "leave" });
  });
});
