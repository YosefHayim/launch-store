import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalDimensions,
  checkScreenshotFile,
  validateAppleDimensions,
  validatePlayDimensions,
} from "./screenshotSpecs.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Write a minimal valid PNG of the given pixel size to disk and return its path. */
function writePng(width: number, height: number): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-specs-"));
  tmpDirs.push(dir);
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(16);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const path = join(dir, "shot.png");
  writeFileSync(path, Buffer.concat([head, ihdr]));
  return path;
}

describe("validateAppleDimensions", () => {
  it("accepts the canonical portrait size for a known slot", () => {
    expect(validateAppleDimensions("APP_IPHONE_67", 1290, 2796)).toEqual({ ok: true });
  });

  it("accepts a non-canonical-but-listed resolution for the slot", () => {
    expect(validateAppleDimensions("APP_IPHONE_67", 1284, 2778)).toEqual({ ok: true });
  });

  it("accepts the landscape swap for an orientation-both slot", () => {
    expect(validateAppleDimensions("APP_IPHONE_67", 2796, 1290)).toEqual({ ok: true });
  });

  it("rejects an off-spec size with the accepted list in the reason", () => {
    const verdict = validateAppleDimensions("APP_IPHONE_67", 1080, 1920);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("1290×2796");
  });

  it("does NOT swap orientation for a fixed slot (Mac is landscape-only)", () => {
    expect(validateAppleDimensions("APP_DESKTOP", 1280, 800).ok).toBe(true);
    expect(validateAppleDimensions("APP_DESKTOP", 800, 1280).ok).toBe(false);
  });

  it("passes an unknown slot (Apple's enum lags new hardware — never reject what we can't check)", () => {
    expect(validateAppleDimensions("APP_IPHONE_69_FUTURE", 9999, 9999)).toEqual({ ok: true });
  });
});

describe("validatePlayDimensions", () => {
  it("accepts a 9:16 phone screenshot", () => {
    expect(validatePlayDimensions(1080, 1920)).toEqual({ ok: true });
  });

  it("rejects a side below the 320px floor", () => {
    expect(validatePlayDimensions(200, 400).ok).toBe(false);
  });

  it("rejects a side above the 3840px ceiling", () => {
    expect(validatePlayDimensions(4000, 2000).ok).toBe(false);
  });

  it("rejects an over-elongated image (longest side > 2× shortest)", () => {
    const verdict = validatePlayDimensions(500, 1200);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("elongated");
  });
});

describe("canonicalDimensions", () => {
  it("returns the Apple slot's canonical size", () => {
    expect(canonicalDimensions("ios", "APP_IPAD_PRO_3GEN_129")).toEqual([2048, 2732]);
  });

  it("returns undefined for an unknown Apple slot", () => {
    expect(canonicalDimensions("ios", "NOPE")).toBeUndefined();
  });

  it("returns the Play form-factor size", () => {
    expect(canonicalDimensions("android", "phone")).toEqual([1080, 1920]);
  });

  it("routes the new Apple platforms to the Apple specs, NOT Play (misroute regression)", () => {
    // tvOS/macOS/visionOS must take the Apple branch; a `=== "ios"` check would drop them into Play and
    // these slot ids don't exist there, so the bug would surface as `undefined`.
    expect(canonicalDimensions("tvos", "APP_APPLE_TV")).toEqual([1920, 1080]);
    expect(canonicalDimensions("macos", "APP_DESKTOP")).toEqual([1280, 800]);
    expect(canonicalDimensions("visionos", "APP_APPLE_VISION_PRO")).toEqual([3840, 2160]);
  });
});

describe("checkScreenshotFile", () => {
  it("measures and passes an in-spec iOS screenshot", () => {
    const check = checkScreenshotFile("ios", "APP_IPHONE_67", writePng(1290, 2796));
    expect(check).toEqual({ measured: true, width: 1290, height: 2796, verdict: { ok: true } });
  });

  it("measures and flags an off-spec iOS screenshot", () => {
    const check = checkScreenshotFile("ios", "APP_IPHONE_67", writePng(1080, 1920));
    expect(check.measured).toBe(true);
    if (!check.measured) return;
    expect(check.verdict.ok).toBe(false);
  });

  it("validates an Android screenshot against Play's constraint", () => {
    const check = checkScreenshotFile("android", "phone", writePng(1080, 1920));
    expect(check.measured && check.verdict.ok).toBe(true);
  });

  it("reports measured:false for a file whose pixels can't be read", () => {
    const dir = mkdtempSync(join(tmpdir(), "launch-specs-"));
    tmpDirs.push(dir);
    const path = join(dir, "not-an-image.png");
    writeFileSync(path, "just some text, not a PNG");
    expect(checkScreenshotFile("ios", "APP_IPHONE_67", path)).toEqual({ measured: false });
  });

  it("validates a tvOS screenshot against the Apple Apple-TV spec (not Play)", () => {
    const check = checkScreenshotFile("tvos", "APP_APPLE_TV", writePng(1920, 1080));
    expect(check.measured && check.verdict.ok).toBe(true);
  });
});
