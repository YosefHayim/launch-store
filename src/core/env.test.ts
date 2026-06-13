import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotenvFile, missingKeys, parseDotenv, secretLookingKeys } from "./env.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-env-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("parseDotenv", () => {
  it("skips blanks and comments, drops `export`, and trims keys", () => {
    const parsed = parseDotenv("# comment\n\nexport FOO=bar\n  BAZ = qux  \n");
    expect(parsed).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("keeps `=` inside values and strips matching surrounding quotes", () => {
    const parsed = parseDotenv(`DSN="postgres://u:p@h/db?x=1"\nQUOTED='a=b'\nBARE=a=b`);
    expect(parsed["DSN"]).toBe("postgres://u:p@h/db?x=1");
    expect(parsed["QUOTED"]).toBe("a=b");
    expect(parsed["BARE"]).toBe("a=b");
  });

  it("ignores lines without an `=`", () => {
    expect(parseDotenv("JUST_A_WORD\nA=1")).toEqual({ A: "1" });
  });
});

describe("loadDotenvFile", () => {
  it("returns an empty object when the file is absent", () => {
    expect(loadDotenvFile(join(makeTempDir(), "nope.env"))).toEqual({});
  });

  it("parses an existing file", () => {
    const dir = makeTempDir();
    const path = join(dir, ".env");
    writeFileSync(path, "API_URL=https://example.com\n");
    expect(loadDotenvFile(path)).toEqual({ API_URL: "https://example.com" });
  });
});

describe("missingKeys — fail before a wasted build", () => {
  it("returns nothing when there is no .env.example to validate against", () => {
    expect(missingKeys(makeTempDir(), { ANYTHING: "1" })).toEqual([]);
  });

  it("flags keys the example documents but the env omits or leaves empty", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env.example"), "API_URL=\nFEATURE_FLAG=\nPRESENT=\n");
    expect(missingKeys(dir, { PRESENT: "yes", EMPTY_ONE: "" }).sort()).toEqual(["API_URL", "FEATURE_FLAG"]);
  });
});

describe("secretLookingKeys — gentle guard against bundling a secret", () => {
  it("flags obvious secret names and unqualified *_KEY names", () => {
    const flagged = secretLookingKeys({
      STRIPE_SECRET: "x",
      DB_PASSWORD: "x",
      SESSION_TOKEN: "x",
      PRIVATE_THING: "x",
      API_KEY: "x",
    });
    expect(flagged.sort()).toEqual(["API_KEY", "DB_PASSWORD", "PRIVATE_THING", "SESSION_TOKEN", "STRIPE_SECRET"]);
  });

  it("does not flag publishable/public/client keys or plain config", () => {
    const flagged = secretLookingKeys({
      STRIPE_PUBLISHABLE_KEY: "x",
      EXPO_PUBLIC_API_KEY: "x",
      CLIENT_KEY: "x",
      API_URL: "x",
      APP_NAME: "x",
    });
    expect(flagged).toEqual([]);
  });
});
