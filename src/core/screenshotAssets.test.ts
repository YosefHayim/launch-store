import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverScreenshots,
  displayTypeLabel,
  fingerprintAsset,
  hashFile,
  KNOWN_DISPLAY_TYPES,
  SCREENSHOTS_DIRNAME,
} from "./screenshotAssets.js";

const tmpDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "screenshot-assets-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Write a file under `appDir`, creating parent folders, and return its absolute path. */
function writeFile(appDir: string, relPath: string, contents: string): string {
  const path = join(appDir, relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

const md5 = (text: string): string => createHash("md5").update(Buffer.from(text)).digest("hex");

describe("hashFile", () => {
  it("returns the MD5 hex and byte length of a file", () => {
    const appDir = workDir();
    const path = writeFile(appDir, "a.png", "pixels");
    expect(hashFile(path)).toEqual({ checksum: md5("pixels"), size: 6 });
  });
});

describe("displayTypeLabel", () => {
  it("maps a known constant to a friendly label", () => {
    expect(displayTypeLabel("APP_IPHONE_67")).toBe(KNOWN_DISPLAY_TYPES["APP_IPHONE_67"]);
    expect(displayTypeLabel("APP_DESKTOP")).toBe("Mac");
  });

  it("falls back to the raw constant for an unknown (new-hardware) type", () => {
    expect(displayTypeLabel("APP_IPHONE_69_FUTURE")).toBe("APP_IPHONE_69_FUTURE");
  });
});

describe("discoverScreenshots", () => {
  it("returns [] when the convention folder is absent", () => {
    expect(discoverScreenshots(workDir())).toEqual([]);
  });

  it("walks locale/displayType folders, fingerprints images, and sorts deterministically", () => {
    const appDir = workDir();
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/02.png`, "two");
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_67/01.png`, "one");
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_DESKTOP/mac.jpg`, "mac");
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/de-DE/APP_IPHONE_67/01.png`, "eins");

    const shots = discoverScreenshots(appDir);
    expect(shots.map((s) => [s.locale, s.displayType, s.fileName])).toEqual([
      ["de-DE", "APP_IPHONE_67", "01.png"],
      ["en-US", "APP_DESKTOP", "mac.jpg"],
      ["en-US", "APP_IPHONE_67", "01.png"],
      ["en-US", "APP_IPHONE_67", "02.png"],
    ]);
    const iphone01 = shots.find((s) => s.locale === "en-US" && s.fileName === "01.png");
    expect(iphone01?.checksum).toBe(md5("one"));
    expect(iphone01?.size).toBe(3);
  });

  it("ignores non-image files and keeps unknown display-type folders (Apple's enum lags new hardware)", () => {
    const appDir = workDir();
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/01.png`, "future");
    writeFile(appDir, `${SCREENSHOTS_DIRNAME}/en-US/APP_IPHONE_69_FUTURE/notes.txt`, "ignore me");

    const shots = discoverScreenshots(appDir);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.displayType).toBe("APP_IPHONE_69_FUTURE");
    expect(shots[0]?.fileName).toBe("01.png");
  });
});

describe("fingerprintAsset", () => {
  it("fingerprints a declared asset resolved relative to the app dir", () => {
    const appDir = workDir();
    writeFile(appDir, "store/review.png", "review");
    const asset = fingerprintAsset(appDir, "store/review.png");
    expect(asset).toEqual({
      path: join(appDir, "store/review.png"),
      fileName: "review.png",
      checksum: md5("review"),
      size: 6,
    });
  });

  it("returns null for a missing file", () => {
    expect(fingerprintAsset(workDir(), "store/missing.png")).toBeNull();
  });

  it("returns null when the path is a directory, not a file", () => {
    const appDir = workDir();
    mkdirSync(join(appDir, "store"), { recursive: true });
    expect(fingerprintAsset(appDir, "store")).toBeNull();
  });
});
