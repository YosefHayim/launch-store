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
import { fuzzyMatch, runBuild, selectApp, sizeSummary, worstDownloadBytes } from "./pipeline.js";
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
});

describe("fuzzyMatch — the app picker's subsequence filter", () => {
  it("matches an in-order subsequence, case-insensitively", () => {
    expect(fuzzyMatch("pmd", "pomedero")).toBe(true);
    expect(fuzzyMatch("PMD", "Pomedero")).toBe(true);
    expect(fuzzyMatch("pomedero", "pomedero")).toBe(true);
  });

  it("rejects characters that aren't a subsequence", () => {
    expect(fuzzyMatch("dmp", "pomedero")).toBe(false);
    expect(fuzzyMatch("xyz", "pomedero")).toBe(false);
  });

  it("treats a blank query as a match so the full list shows", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
    expect(fuzzyMatch("   ", "anything")).toBe(true);
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
