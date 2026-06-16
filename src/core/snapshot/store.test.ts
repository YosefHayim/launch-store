import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSnapshots, loadSnapshot, saveSnapshot } from "./store.js";
import type { Snapshot } from "./types.js";

/** A minimal valid snapshot, overridable per field. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    name: "before-sync",
    capturedAt: "2026-06-16T00:00:00.000Z",
    reports: [
      {
        id: "apple-products",
        title: "App Store in-app purchases",
        store: "appstore",
        outcome: { state: "captured", apps: [{ app: "alpha", identifier: "com.acme.alpha", entities: [] }] },
      },
    ],
    ...over,
  };
}

describe("snapshot store", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-snapshots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a snapshot through save → load unchanged", () => {
    const snapshot = snap();
    saveSnapshot(snapshot, dir);
    expect(loadSnapshot(snapshot.name, dir)).toEqual(snapshot);
  });

  it("overwrites a snapshot re-saved under the same name", () => {
    saveSnapshot(snap({ capturedAt: "2026-06-16T00:00:00.000Z" }), dir);
    saveSnapshot(snap({ capturedAt: "2026-06-16T12:00:00.000Z" }), dir);
    expect(loadSnapshot("before-sync", dir)?.capturedAt).toBe("2026-06-16T12:00:00.000Z");
    expect(listSnapshots(dir)).toHaveLength(1);
  });

  it("returns null for an unknown name", () => {
    expect(loadSnapshot("nope", dir)).toBeNull();
  });

  it("tolerates a corrupt record (reads as null, skips it in lists)", () => {
    writeFileSync(join(dir, "broken.json"), "{ not json");
    saveSnapshot(snap(), dir);
    expect(loadSnapshot("broken", dir)).toBeNull();
    expect(listSnapshots(dir)).toHaveLength(1);
  });

  it("lists snapshots newest-first by capturedAt", () => {
    saveSnapshot(snap({ name: "old", capturedAt: "2026-06-10T00:00:00.000Z" }), dir);
    saveSnapshot(snap({ name: "new", capturedAt: "2026-06-15T00:00:00.000Z" }), dir);
    expect(listSnapshots(dir).map((s) => s.name)).toEqual(["new", "old"]);
  });

  it("returns an empty list when no snapshots directory exists", () => {
    expect(listSnapshots(join(dir, "missing"))).toEqual([]);
  });
});
