/**
 * Tests for the `.p8` discovery + Key-ID extraction helpers (issues #2/#3). Filesystem discovery is
 * exercised against a real temp directory; the rest is pure.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from "./keyfile.js";

describe("extractKeyId", () => {
  it("pulls the Key ID out of an AuthKey_<KEYID>.p8 filename", () => {
    expect(extractKeyId("AuthKey_F5763D97BY.p8")).toBe("F5763D97BY");
  });

  it("works on a full path and upper-cases the result", () => {
    expect(extractKeyId("/Users/me/Downloads/AuthKey_qs5924q3md.p8")).toBe("QS5924Q3MD");
  });

  it("returns null for a name that isn't an Apple key file", () => {
    expect(extractKeyId("/tmp/some-other-key.p8")).toBeNull();
    expect(extractKeyId("AuthKey_short.p8")).toBeNull(); // captured id < 8 chars
  });
});

describe("findAuthKeyFiles", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-keys-"));
    writeFileSync(join(dir, "AuthKey_AAAA111122.p8"), "x");
    writeFileSync(join(dir, "AuthKey_BBBB333344.p8"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "random.p8"), "x");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns only AuthKey_*.p8 files, as absolute paths", () => {
    const found = findAuthKeyFiles(dir);
    expect(found).toEqual([join(dir, "AuthKey_BBBB333344.p8"), join(dir, "AuthKey_AAAA111122.p8")]);
  });

  it("returns [] for a directory that doesn't exist", () => {
    expect(findAuthKeyFiles(join(dir, "nope"))).toEqual([]);
  });
});

describe("reconcileKeyId", () => {
  it("uses the explicit value when no filename id is present", () => {
    expect(reconcileKeyId("abc12345", null)).toBe("ABC12345");
  });

  it("uses the filename id when nothing explicit was given", () => {
    expect(reconcileKeyId(undefined, "F5763D97BY")).toBe("F5763D97BY");
  });

  it("accepts a case-insensitive match between the two", () => {
    expect(reconcileKeyId("f5763d97by", "F5763D97BY")).toBe("F5763D97BY");
  });

  it("throws when an explicit Key ID contradicts the filename", () => {
    expect(() => reconcileKeyId("WRONGKEY12", "F5763D97BY")).toThrow(/doesn't match/);
  });

  it("returns undefined when neither source has a Key ID", () => {
    expect(reconcileKeyId(undefined, null)).toBeUndefined();
  });
});
