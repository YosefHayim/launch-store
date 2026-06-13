import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, loadConfig } from "./config.js";

const tempDirs: string[] = [];
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-config-"));
  tempDirs.push(dir);
  return dir;
}
/** Write an app.json (Expo `{ expo: {...} }` wrapper) into a (possibly nested) app directory. */
function writeApp(repo: string, relDir: string, expo: Record<string, unknown>): void {
  const dir = join(repo, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo }));
}
/** Write an arbitrary config file (e.g. app.config.ts) into a (possibly nested) app directory. */
function writeConfigFile(repo: string, relDir: string, filename: string, contents: string): void {
  const dir = join(repo, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), contents);
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("defineConfig", () => {
  it("fills the v1 defaults so a minimal config only declares profiles", () => {
    const config = defineConfig({ profiles: { production: { name: "production" } } });
    expect(config.credentials).toBe("local");
    expect(config.storage).toBe("local");
    expect(config.buildEngine).toBe("fastlane");
    expect(config.appRoots).toBeUndefined();
  });

  it("preserves explicit overrides and appRoots", () => {
    const config = defineConfig({
      credentials: "team",
      storage: "s3",
      appRoots: ["./apps"],
      profiles: { preview: { name: "preview" } },
    });
    expect(config.credentials).toBe("team");
    expect(config.storage).toBe("s3");
    expect(config.appRoots).toEqual(["./apps"]);
  });
});

describe("loadConfig — auto-discovers apps, app.json stays the source of truth", () => {
  it("falls back to defaults and discovers a single app's facts from app.json", async () => {
    const repo = makeRepo();
    writeApp(repo, ".", {
      name: "Hello World",
      slug: "hello-world",
      version: "1.2.3",
      ios: { bundleIdentifier: "com.example.hello" },
    });

    const { config, apps } = await loadConfig(repo);

    expect(config.buildEngine).toBe("fastlane");
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "hello-world", bundleId: "com.example.hello", version: "1.2.3" });
  });

  it("scans nested directories but skips heavy/generated folders", async () => {
    const repo = makeRepo();
    writeApp(repo, "apps/alpha", { slug: "alpha", ios: { bundleIdentifier: "com.example.alpha" } });
    writeApp(repo, "apps/beta", { slug: "beta" });
    // An app.json buried in a skipped directory must NOT be discovered.
    writeApp(repo, "node_modules/pkg", { slug: "ghost" });

    const { apps } = await loadConfig(repo);
    const names = apps.map((app) => app.name).sort();

    expect(names).toEqual(["alpha", "beta"]);
  });

  it("derives the handle from slug or name and tolerates a flat (unwrapped) config", async () => {
    const repo = makeRepo();
    const dir = join(repo, "flat");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({ name: "Flat App" }));

    const { apps } = await loadConfig(repo);

    expect(apps).toHaveLength(1);
    expect(apps[0]?.name).toBe("flat app");
    expect(apps[0]?.bundleId).toBeUndefined();
  });

  it("ignores an app.json with neither slug nor name", async () => {
    const repo = makeRepo();
    const dir = join(repo, "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));

    const { apps } = await loadConfig(repo);
    expect(apps).toHaveLength(0);
  });
});

describe("loadConfig — reads dynamic Expo config (app.config.{ts,js}) and bare React Native", () => {
  it("discovers an app from an object-export app.config.ts", async () => {
    const repo = makeRepo();
    writeConfigFile(
      repo,
      "ts-app",
      "app.config.ts",
      `export default { expo: { name: "TS App", slug: "ts-app", version: "2.0.0", ios: { bundleIdentifier: "com.example.ts" } } };`,
    );

    const { apps } = await loadConfig(repo);

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "ts-app", bundleId: "com.example.ts", version: "2.0.0" });
  });

  it("evaluates a function-form app.config.js, handing it the static config to extend", async () => {
    const repo = makeRepo();
    writeApp(repo, "dyn", { slug: "static-slug", ios: { bundleIdentifier: "com.example.dyn" } });
    writeConfigFile(
      repo,
      "dyn",
      "app.config.js",
      `export default ({ config }) => ({ expo: { ...config.expo, slug: "dynamic-slug", version: "9.9.9" } });`,
    );

    const { apps } = await loadConfig(repo);

    // The dynamic config wins over app.json, but kept the bundle id it received from it.
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "dynamic-slug", bundleId: "com.example.dyn", version: "9.9.9" });
  });

  it("discovers a bare React Native app.json (name only, no expo wrapper or bundle id)", async () => {
    const repo = makeRepo();
    const dir = join(repo, "bare");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({ name: "BareRN", displayName: "Bare RN" }));

    const { apps } = await loadConfig(repo);

    expect(apps).toHaveLength(1);
    expect(apps[0]?.name).toBe("barern");
    expect(apps[0]?.bundleId).toBeUndefined();
  });

  it("falls back to the static app.json when a dynamic config throws on evaluation", async () => {
    const repo = makeRepo();
    writeApp(repo, "broken-dyn", { slug: "fallback", ios: { bundleIdentifier: "com.example.fb" } });
    writeConfigFile(repo, "broken-dyn", "app.config.ts", `throw new Error("boom");`);

    const { apps } = await loadConfig(repo);

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "fallback", bundleId: "com.example.fb" });
  });
});
