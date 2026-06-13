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
import { runBuild, selectApp } from "./pipeline.js";
import type { AppDescriptor } from "./types.js";

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
