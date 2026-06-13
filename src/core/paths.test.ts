import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARTIFACTS_DIR,
  ARTIFACT_INDEX,
  CREDENTIALS_DIR,
  CREDENTIALS_INDEX,
  PROVISIONING_PROFILES_DIR,
  RELAY_HOME,
  ensureDir,
} from "./paths.js";

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("paths — one canonical layout for ~/.relay", () => {
  it("nests all local state under ~/.relay", () => {
    expect(RELAY_HOME.endsWith(".relay")).toBe(true);
    expect(ARTIFACTS_DIR.startsWith(RELAY_HOME)).toBe(true);
    expect(ARTIFACT_INDEX.startsWith(ARTIFACTS_DIR)).toBe(true);
    expect(CREDENTIALS_INDEX.startsWith(CREDENTIALS_DIR)).toBe(true);
  });

  it("points the profile install dir at where Xcode looks", () => {
    expect(PROVISIONING_PROFILES_DIR).toContain(join("Library", "MobileDevice", "Provisioning Profiles"));
  });

  it("ensureDir creates nested directories idempotently and returns the path", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-paths-"));
    tempDirs.push(root);
    const nested = join(root, "a", "b", "c");
    expect(ensureDir(nested)).toBe(nested);
    expect(existsSync(nested) && statSync(nested).isDirectory()).toBe(true);
    expect(() => ensureDir(nested)).not.toThrow();
  });
});
