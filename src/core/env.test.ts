import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENV_SOURCE,
  formatEnvTable,
  loadDotenvFile,
  missingKeys,
  parseCliEnv,
  parseDotenv,
  resolveEnv,
  secretLookingKeys,
} from "./env.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-env-"));
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

describe("resolveEnv — the one precedence ladder", () => {
  it("layers lowest→highest: .env < .env.<profile> < .env.local < profile env: < secrets < flags", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env"), "A=base\nB=base\nC=base\nD=base\nE=base\nF=base\n");
    writeFileSync(
      join(dir, ".env.production"),
      "B=profileFile\nC=profileFile\nD=profileFile\nE=profileFile\nF=profileFile\n",
    );
    writeFileSync(join(dir, ".env.local"), "C=local\nD=local\nE=local\nF=local\n");
    const resolved = resolveEnv({
      appDir: dir,
      profileName: "production",
      includeLocal: true,
      profileEnv: { D: "profileInline", E: "profileInline", F: "profileInline" },
      secrets: { E: "secret", F: "secret" },
      cliEnv: { F: "flag" },
    });
    expect(resolved.values).toEqual({
      A: "base",
      B: "profileFile",
      C: "local",
      D: "profileInline",
      E: "secret",
      F: "flag",
    });
    expect(resolved.sources).toEqual({
      A: ".env",
      B: ".env.production",
      C: ENV_SOURCE.local,
      D: ENV_SOURCE.profile,
      E: ENV_SOURCE.secret,
      F: ENV_SOURCE.flag,
    });
  });

  it("omits .env.local unless includeLocal is set", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env"), "X=base\n");
    writeFileSync(join(dir, ".env.local"), "X=local\n");
    expect(resolveEnv({ appDir: dir, profileName: "production" }).values).toEqual({ X: "base" });
    expect(resolveEnv({ appDir: dir, profileName: "production", includeLocal: true }).values).toEqual({ X: "local" });
  });

  it("renames the base file via envFile and still derives .env.<profile> by name", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "custom.env"), "A=fromCustom\nB=fromCustom\n");
    writeFileSync(join(dir, ".env.staging"), "B=fromProfileFile\n");
    const resolved = resolveEnv({ appDir: dir, profileName: "staging", envFile: "custom.env" });
    expect(resolved.values).toEqual({ A: "fromCustom", B: "fromProfileFile" });
    expect(resolved.sources).toEqual({ A: "custom.env", B: ".env.staging" });
  });

  it("returns empty maps when nothing resolves", () => {
    const resolved = resolveEnv({ appDir: makeTempDir(), profileName: "production" });
    expect(resolved.values).toEqual({});
    expect(resolved.sources).toEqual({});
  });
});

describe("parseCliEnv — repeated --env KEY=VAL", () => {
  it("splits on the first = and keeps = in the value", () => {
    expect(parseCliEnv(["A=1", "DSN=postgres://u:p@h/db?x=1"])).toEqual({ A: "1", DSN: "postgres://u:p@h/db?x=1" });
  });

  it("throws on a pair with no = or an empty key", () => {
    expect(() => parseCliEnv(["NOPE"])).toThrow(/Invalid --env/);
    expect(() => parseCliEnv(["=value"])).toThrow(/empty/);
  });
});

describe("formatEnvTable — masked provenance for --print-env", () => {
  it("masks secret-looking names and keychain values, shows the rest, labels sources", () => {
    const table = formatEnvTable({
      values: { API_URL: "https://example.test", API_TOKEN: "tok_distinct", FEATURE: "kc_distinct" },
      sources: { API_URL: ".env", API_TOKEN: ENV_SOURCE.flag, FEATURE: ENV_SOURCE.secret },
    });
    expect(table).toContain("https://example.test"); // non-secret value shown in full
    expect(table).not.toContain("tok_distinct"); // secret-looking name masked even though it's a flag
    expect(table).not.toContain("kc_distinct"); // keychain-sourced value masked even with an innocuous name
    expect(table).toContain("••••••");
    expect(table).toContain(".env");
  });

  it("reports when nothing resolved", () => {
    expect(formatEnvTable({ values: {}, sources: {} })).toBe("(no env vars resolved)");
  });
});
