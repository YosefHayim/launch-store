import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLastApp, readLastBump, readLastRun, rememberLastRun } from "./lastRun.js";

describe("lastRun — remembered build picks round-trip through a temp file", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-lastrun-"));
    file = join(dir, "last-run.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads an empty, well-formed state before anything is written", () => {
    expect(readLastRun(file)).toEqual({ apps: {} });
    expect(readLastApp(file)).toBeUndefined();
    expect(readLastBump("pomedero", file)).toBeUndefined();
  });

  it("remembers the last app and its bump, then reads them back", () => {
    rememberLastRun("pomedero", "patch", file);
    expect(readLastApp(file)).toBe("pomedero");
    expect(readLastBump("pomedero", file)).toBe("patch");
  });

  it("updates lastApp without clobbering another app's remembered bump", () => {
    rememberLastRun("pomedero", "minor", file);
    rememberLastRun("arcade", "major", file);
    expect(readLastApp(file)).toBe("arcade");
    expect(readLastBump("pomedero", file)).toBe("minor"); // untouched
    expect(readLastBump("arcade", file)).toBe("major");
  });

  it("leaves a prior bump untouched when none is applied (Custom / --yes / CI passes undefined)", () => {
    rememberLastRun("pomedero", "patch", file);
    rememberLastRun("pomedero", undefined, file);
    expect(readLastApp(file)).toBe("pomedero");
    expect(readLastBump("pomedero", file)).toBe("patch");
  });

  it("tolerates a malformed file, reading as nothing remembered", () => {
    writeFileSync(file, "{ not json");
    expect(readLastRun(file)).toEqual({ apps: {} });
  });
});
