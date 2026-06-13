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
