import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldStoreConfig } from "./scaffold.js";

describe("scaffoldStoreConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-scaffold-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits a skeleton artifact and a manual note when none exists", () => {
    const { artifact, note } = scaffoldStoreConfig(dir);
    expect(artifact?.path).toBe("store.config.json");
    expect(artifact?.contents).toContain('"configVersion"');
    expect(note.level).toBe("manual");
    expect(note.message).toContain("store.config.json");
  });

  it("emits no artifact and a skipped note when one is already present", () => {
    writeFileSync(join(dir, "store.config.json"), "{}");
    const { artifact, note } = scaffoldStoreConfig(dir);
    expect(artifact).toBeNull();
    expect(note.level).toBe("skipped");
  });
});
