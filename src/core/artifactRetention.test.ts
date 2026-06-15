import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuildArtifact, LaunchConfig } from "./types.js";
import {
  DEFAULT_RETENTION_DAYS,
  planPrune,
  readArtifactIndex,
  resolveCommandRetentionDays,
  resolveRetentionDays,
  runArtifactPrune,
  writeArtifactIndex,
} from "./artifactRetention.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A fixed reference "now" so age math is deterministic (no wall clock in the tests). */
const NOW = Date.parse("2026-06-15T00:00:00.000Z");
/** ISO stamp for a build created `days` before {@link NOW}. */
const daysAgo = (days: number): string => new Date(NOW - days * DAY_MS).toISOString();

/** A stored-build fixture; override any field to vary one dimension under test. */
function artifact(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
  return {
    path: "/tmp/demo-1.0.0-7-ios.ipa",
    platform: "ios",
    appName: "demo",
    profile: "production",
    version: "1.0.0",
    buildNumber: 7,
    sizeReport: { artifactBytes: 10, entries: [] },
    clean: true,
    createdAt: daysAgo(1),
    ...overrides,
  };
}

/** A minimal valid config; retention helpers only read `artifactRetentionDays`. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
    profiles: {},
    ...overrides,
  };
}

describe("planPrune — the keep-newest-per-app+platform policy", () => {
  it("prunes a build past the window but keeps the newest of its app+platform", () => {
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(2) });
    const old = artifact({ buildNumber: 7, createdAt: daysAgo(40) });
    const { prune, keep } = planPrune([newest, old], { now: NOW, retentionDays: 30 });
    expect(prune).toEqual([old]);
    expect(keep).toEqual([newest]);
  });

  it("never prunes the newest build even when it is itself past the window", () => {
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(40) });
    const older = artifact({ buildNumber: 7, createdAt: daysAgo(60) });
    const { prune, keep } = planPrune([newest, older], { now: NOW, retentionDays: 30 });
    expect(prune).toEqual([older]); // the newest survives despite being 40d old
    expect(keep).toContain(newest);
  });

  it("keeps the newest of EACH app+platform group independently", () => {
    const iosNew = artifact({ appName: "a", platform: "ios", buildNumber: 9, createdAt: daysAgo(40) });
    const iosOld = artifact({ appName: "a", platform: "ios", buildNumber: 8, createdAt: daysAgo(50) });
    const androidNew = artifact({ appName: "a", platform: "android", buildNumber: 5, createdAt: daysAgo(40) });
    const { prune } = planPrune([iosNew, iosOld, androidNew], { now: NOW, retentionDays: 30 });
    expect(prune).toEqual([iosOld]); // each group's newest (iosNew, androidNew) is kept
  });

  it("prunes nothing inside the window", () => {
    const builds = [
      artifact({ buildNumber: 9, createdAt: daysAgo(2) }),
      artifact({ buildNumber: 7, createdAt: daysAgo(10) }),
    ];
    expect(planPrune(builds, { now: NOW, retentionDays: 30 }).prune).toEqual([]);
  });

  it("treats retentionDays <= 0 as disabled (prunes nothing)", () => {
    const builds = [
      artifact({ buildNumber: 9, createdAt: daysAgo(2) }),
      artifact({ buildNumber: 7, createdAt: daysAgo(99) }),
    ];
    expect(planPrune(builds, { now: NOW, retentionDays: 0 }).prune).toEqual([]);
  });

  it("skips a row whose binary was already pruned", () => {
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(2) });
    const alreadyGone = artifact({ buildNumber: 7, createdAt: daysAgo(40), prunedAt: daysAgo(5) });
    expect(planPrune([newest, alreadyGone], { now: NOW, retentionDays: 30 }).prune).toEqual([]);
  });

  it("never prunes a row with a missing/unparseable createdAt (can't age it → keep it)", () => {
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(2) });
    const undated = artifact({ buildNumber: 7, createdAt: "not-a-date" });
    expect(planPrune([newest, undated], { now: NOW, retentionDays: 30 }).prune).toEqual([]);
  });

  it("limits the sweep to the named app, leaving other apps untouched", () => {
    const aNew = artifact({ appName: "a", buildNumber: 9, createdAt: daysAgo(2) });
    const aOld = artifact({ appName: "a", buildNumber: 8, createdAt: daysAgo(40) });
    const bOld = artifact({ appName: "b", buildNumber: 3, createdAt: daysAgo(40) });
    const bOlder = artifact({ appName: "b", buildNumber: 2, createdAt: daysAgo(50) });
    const { prune, keep } = planPrune([aNew, aOld, bOld, bOlder], { now: NOW, retentionDays: 30, app: "a" });
    expect(prune).toEqual([aOld]);
    expect(keep).toEqual(expect.arrayContaining([bOld, bOlder])); // app b not considered at all
  });

  it("limits the sweep to the named platform", () => {
    const iosOld = artifact({ buildNumber: 9, platform: "ios", createdAt: daysAgo(40) });
    const iosOlder = artifact({ buildNumber: 8, platform: "ios", createdAt: daysAgo(50) });
    const androidOld = artifact({ buildNumber: 4, platform: "android", createdAt: daysAgo(40) });
    const androidOlder = artifact({ buildNumber: 3, platform: "android", createdAt: daysAgo(50) });
    const { prune } = planPrune([iosOld, iosOlder, androidOld, androidOlder], {
      now: NOW,
      retentionDays: 30,
      platform: "android",
    });
    expect(prune).toEqual([androidOlder]); // only android considered; its newest (androidOld) kept
  });
});

describe("resolveRetentionDays — the automatic sweep's window", () => {
  it("defaults to 30 when unset", () => {
    expect(resolveRetentionDays(config())).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("returns a configured value verbatim", () => {
    expect(resolveRetentionDays(config({ artifactRetentionDays: 14 }))).toBe(14);
  });

  it("returns 0 when explicitly disabled (the pipeline reads this as 'skip')", () => {
    expect(resolveRetentionDays(config({ artifactRetentionDays: 0 }))).toBe(0);
  });
});

describe("resolveCommandRetentionDays — the explicit `builds prune` window", () => {
  it("uses the configured value when no override is given", () => {
    expect(resolveCommandRetentionDays(config({ artifactRetentionDays: 14 }))).toBe(14);
  });

  it("lets a --days override win over config", () => {
    expect(resolveCommandRetentionDays(config({ artifactRetentionDays: 14 }), 7)).toBe(7);
  });

  it("falls back to the default when auto is disabled (0) — an explicit prune still does something", () => {
    expect(resolveCommandRetentionDays(config({ artifactRetentionDays: 0 }))).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("defaults to 30 when nothing is configured or passed", () => {
    expect(resolveCommandRetentionDays(config())).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("readArtifactIndex / writeArtifactIndex — index I/O round-trip", () => {
  let dir: string;
  let indexPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-index-"));
    indexPath = join(dir, "index.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] for a missing index", () => {
    expect(readArtifactIndex(indexPath)).toEqual([]);
  });

  it("returns [] for a malformed index", () => {
    writeFileSync(indexPath, "{ not json");
    expect(readArtifactIndex(indexPath)).toEqual([]);
  });

  it("round-trips a written index", () => {
    const index = [artifact({ buildNumber: 9 }), artifact({ buildNumber: 7 })];
    writeArtifactIndex(index, indexPath);
    expect(readArtifactIndex(indexPath)).toEqual(index);
  });
});

describe("runArtifactPrune — executes the plan against a real index + binaries", () => {
  let dir: string;
  let indexPath: string;
  /** Write a `bytes`-sized fake binary in the temp dir and return its absolute path. */
  const makeBinary = (name: string, bytes: number): string => {
    const path = join(dir, name);
    writeFileSync(path, Buffer.alloc(bytes));
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-prune-"));
    indexPath = join(dir, "index.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("deletes the old binary, keeps the newest, stamps prunedAt, and reports freed bytes", () => {
    const newestPath = makeBinary("newest.ipa", 100);
    const oldPath = makeBinary("old.ipa", 4000);
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(2), path: newestPath });
    const old = artifact({ buildNumber: 7, createdAt: daysAgo(40), path: oldPath });
    writeArtifactIndex([newest, old], indexPath);

    const result = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });

    expect(result.dryRun).toBe(false);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0]).toMatchObject({ buildNumber: 7, bytes: 4000 });
    expect(result.freedBytes).toBe(4000);
    expect(existsSync(oldPath)).toBe(false); // binary gone
    expect(existsSync(newestPath)).toBe(true); // newest survives

    const written = readArtifactIndex(indexPath);
    expect(written.find((b) => b.buildNumber === 7)?.prunedAt).toBe(new Date(NOW).toISOString());
    expect(written.find((b) => b.buildNumber === 9)?.prunedAt).toBeUndefined();
  });

  it("dry-run deletes nothing and leaves the index untouched", () => {
    const newestPath = makeBinary("newest.ipa", 100);
    const oldPath = makeBinary("old.ipa", 4000);
    const index = [
      artifact({ buildNumber: 9, createdAt: daysAgo(2), path: newestPath }),
      artifact({ buildNumber: 7, createdAt: daysAgo(40), path: oldPath }),
    ];
    writeArtifactIndex(index, indexPath);

    const result = runArtifactPrune({ now: NOW, retentionDays: 30, dryRun: true, indexPath });

    expect(result.dryRun).toBe(true);
    expect(result.pruned).toHaveLength(1);
    expect(result.freedBytes).toBe(4000);
    expect(existsSync(oldPath)).toBe(true); // nothing deleted
    expect(readArtifactIndex(indexPath)).toEqual(index); // index unchanged
  });

  it("is a no-op (no index write) when nothing is eligible", () => {
    const path = makeBinary("only.ipa", 100);
    writeArtifactIndex([artifact({ buildNumber: 9, createdAt: daysAgo(2), path })], indexPath);
    const before = readFileSync(indexPath, "utf8");

    const result = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });

    expect(result.pruned).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(readFileSync(indexPath, "utf8")).toBe(before); // byte-identical: not rewritten
  });

  it("still records a prune when the binary is already missing (uses the recorded size)", () => {
    const newestPath = makeBinary("newest.ipa", 100);
    const newest = artifact({ buildNumber: 9, createdAt: daysAgo(2), path: newestPath });
    const old = artifact({
      buildNumber: 7,
      createdAt: daysAgo(40),
      path: join(dir, "missing.ipa"), // never created
      sizeReport: { artifactBytes: 555, entries: [] },
    });
    writeArtifactIndex([newest, old], indexPath);

    const result = runArtifactPrune({ now: NOW, retentionDays: 30, indexPath });

    expect(result.freedBytes).toBe(555); // falls back to the recorded artifactBytes
    expect(readArtifactIndex(indexPath).find((b) => b.buildNumber === 7)?.prunedAt).toBeDefined();
  });
});
