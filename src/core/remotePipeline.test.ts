import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A dry-run must never shell out (no ssh/scp/rsync/aws) — make any spawn an immediate, obvious failure.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    throw new Error("spawn must not run during --dry-run");
  }),
}));

import { registerBuiltins } from "../providers/index.js";
import { prepareBuild, runBuild } from "./pipeline.js";
import { runEasBuild } from "./easPipeline.js";

registerBuiltins();

/** Any network call during a dry-run is a bug — the rehearsal makes no AWS/Expo/account changes. */
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

function writeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-remote-"));
  writeFileSync(
    join(dir, "app.json"),
    JSON.stringify({ expo: { slug: "hello", version: "1.0.0", ios: { bundleIdentifier: "com.example.hello" } } }),
  );
  return dir;
}

const base = {
  platform: "ios" as const,
  profileName: "production",
  appName: undefined,
  explain: false,
  submit: true,
  target: "testflight" as const,
  dryRun: true,
};

describe("remote build --dry-run rehearses with no SSH/AWS/network", () => {
  it("rehearses the AWS remote path", async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(runBuild({ ...base, remote: { kind: "aws" } })).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });

  it("rehearses the SSH (byo) remote path", async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    await expect(runBuild({ ...base, remote: { kind: "ssh", target: "ec2-user@1.2.3.4" } })).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});

describe("EAS handoff --dry-run rehearses with no eas-cli/network", () => {
  it("rehearses the EAS path", async () => {
    tempRepo = writeRepo();
    process.chdir(tempRepo);
    const prepared = await prepareBuild(base);
    await expect(runEasBuild(prepared, base)).resolves.toBeUndefined();
    expect(fetchGuard).not.toHaveBeenCalled();
  });
});
