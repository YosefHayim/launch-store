import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, loadConfig, resolveSidecarConfig, writeAppEntitlements, writeAppVersion } from "./config.js";
import type { AppDescriptor } from "./types.js";

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
    expect(config.submit).toBe("app-store-connect");
    expect(config.appRoots).toBeUndefined();
    expect(config.aws).toBeUndefined();
    expect(config.release).toBeUndefined();
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

  it("carries an explicit release policy through unchanged", () => {
    const config = defineConfig({
      profiles: { production: { name: "production" } },
      release: { releaseType: "MANUAL", phasedRelease: true, releaseNotes: "Bug fixes." },
    });
    expect(config.release).toEqual({ releaseType: "MANUAL", phasedRelease: true, releaseNotes: "Bug fixes." });
  });

  it("carries the folded App Store Connect sections through (issue #101)", () => {
    const config = defineConfig({
      profiles: { production: { name: "production" } },
      gameCenter: { "com.acme.app": { achievements: [] } },
      appClips: { "com.acme.app": { clips: {} } },
      releaseAttributes: { "com.acme.app": { pricing: { customerPrice: 0 } } },
      wallet: { merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme" }] },
      euDistribution: { domains: [{ domain: "downloads.acme.com", referenceName: "Acme" }] },
    });
    expect(config.gameCenter).toEqual({ "com.acme.app": { achievements: [] } });
    expect(config.appClips).toEqual({ "com.acme.app": { clips: {} } });
    expect(config.releaseAttributes).toEqual({ "com.acme.app": { pricing: { customerPrice: 0 } } });
    expect(config.wallet).toEqual({ merchantIds: [{ identifier: "merchant.com.acme.app", name: "Acme" }] });
    expect(config.euDistribution).toEqual({ domains: [{ domain: "downloads.acme.com", referenceName: "Acme" }] });
  });

  it("omits the folded sections when they aren't declared", () => {
    const config = defineConfig({ profiles: { production: { name: "production" } } });
    expect(config.gameCenter).toBeUndefined();
    expect(config.appClips).toBeUndefined();
    expect(config.releaseAttributes).toBeUndefined();
    expect(config.wallet).toBeUndefined();
    expect(config.euDistribution).toBeUndefined();
  });
});

describe("resolveSidecarConfig — typed field vs JSON sidecar precedence (issue #101)", () => {
  /** A loader that reads + JSON-parses the sidecar, like the real `load*Config` helpers. */
  const readJson = (path: string): { source: string } => JSON.parse(readFileSync(path, "utf8")) as { source: string };

  it("uses the typed field when present and --config was left at its default", () => {
    const result = resolveSidecarConfig({
      typed: { source: "typed" },
      configPath: "/nonexistent.config.json",
      explicitPath: false,
      load: () => ({ source: "sidecar" }),
    });
    expect(result).toEqual({ source: "typed" });
  });

  it("falls back to the default-path sidecar when there is no typed field", () => {
    const path = join(makeRepo(), "x.config.json");
    writeFileSync(path, JSON.stringify({ source: "sidecar" }));
    expect(resolveSidecarConfig({ typed: undefined, configPath: path, explicitPath: false, load: readJson })).toEqual({
      source: "sidecar",
    });
  });

  it("returns undefined when neither a typed field nor a default-path sidecar exists", () => {
    const path = join(makeRepo(), "missing.config.json");
    expect(
      resolveSidecarConfig({
        typed: undefined,
        configPath: path,
        explicitPath: false,
        load: (): { source: string } => {
          throw new Error("should not be called");
        },
      }),
    ).toBeUndefined();
  });

  it("an explicitly-passed --config wins even when a typed field is present", () => {
    const path = join(makeRepo(), "explicit.config.json");
    writeFileSync(path, JSON.stringify({ source: "sidecar" }));
    expect(
      resolveSidecarConfig({ typed: { source: "typed" }, configPath: path, explicitPath: true, load: readJson }),
    ).toEqual({
      source: "sidecar",
    });
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
    expect(apps[0]?.usesNonExemptEncryption).toBeUndefined();
  });

  it("reads the Expo export-compliance answer (ios.config.usesNonExemptEncryption)", async () => {
    const repo = makeRepo();
    writeApp(repo, ".", {
      slug: "secure-app",
      ios: { bundleIdentifier: "com.example.secure", config: { usesNonExemptEncryption: false } },
    });

    const { apps } = await loadConfig(repo);

    expect(apps[0]?.usesNonExemptEncryption).toBe(false);
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

describe("loadConfig — resolves the launch-store import without a local dependency (issue #8)", () => {
  it("loads a config that imports defineConfig from launch-store in a project with no node_modules", async () => {
    const repo = makeRepo();
    // This temp repo has no node_modules, so `import "launch-store"` can only resolve via the loader's
    // self-alias. Before the alias a globally-installed CLI threw "Cannot find package 'launch-store'".
    writeFileSync(
      join(repo, "launch.config.ts"),
      `import { defineConfig } from "launch-store";\n` +
        `export default defineConfig({ profiles: { staging: { name: "staging", sizeBudgetMB: 123 } } });\n`,
    );
    writeApp(repo, ".", { name: "Hello", slug: "hello", ios: { bundleIdentifier: "com.example.hello" } });

    const { config } = await loadConfig(repo);

    // The custom profile proves OUR file loaded; the filled-in default proves it ran through defineConfig.
    expect(config.profiles["staging"]?.sizeBudgetMB).toBe(123);
    expect(config.buildEngine).toBe("fastlane");
  });
});

describe("writeAppVersion — persist the bump back to a static app.json", () => {
  it("updates expo.version on a discovered app, leaving siblings intact", async () => {
    const repo = makeRepo();
    writeApp(repo, ".", { name: "Hello", slug: "hello", version: "1.0.0", ios: { bundleIdentifier: "com.x" } });
    const app = (await loadConfig(repo)).apps[0]!;

    expect(writeAppVersion(app, "1.0.1")).toBe(true);

    const written = JSON.parse(readFileSync(join(repo, "app.json"), "utf8"));
    expect(written.expo.version).toBe("1.0.1");
    expect(written.expo.ios.bundleIdentifier).toBe("com.x");
  });

  it("writes a flat version when there's no expo wrapper", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "app.json"), JSON.stringify({ name: "Bare", slug: "bare", version: "0.1.0" }));
    const app: AppDescriptor = { name: "bare", dir: repo, configPath: join(repo, "app.json"), version: "0.1.0" };

    expect(writeAppVersion(app, "0.2.0")).toBe(true);
    expect(JSON.parse(readFileSync(join(repo, "app.json"), "utf8")).version).toBe("0.2.0");
  });

  it("refuses a dynamic config (app.config.ts) — the caller stamps the native project instead", () => {
    const app: AppDescriptor = {
      name: "dyn",
      dir: "/tmp/does-not-matter",
      configPath: "/tmp/does-not-matter/app.config.ts",
      version: "1.0.0",
    };
    expect(writeAppVersion(app, "1.1.0")).toBe(false);
  });
});

describe("writeAppEntitlements", () => {
  /** Build an AppDescriptor pointing at a freshly-written app.json in a temp repo. */
  function appWith(expo: Record<string, unknown>): AppDescriptor {
    const repo = makeRepo();
    writeApp(repo, "app", expo);
    return { name: "app", dir: join(repo, "app"), configPath: join(repo, "app", "app.json") };
  }

  it("adds entitlements under expo.ios.entitlements and returns the keys it wrote", () => {
    const app = appWith({ ios: { bundleIdentifier: "com.acme.app" } });
    const added = writeAppEntitlements(app, { "aps-environment": "production", "com.apple.developer.healthkit": true });
    expect(added.sort()).toEqual(["aps-environment", "com.apple.developer.healthkit"]);
    const raw = JSON.parse(readFileSync(app.configPath, "utf8")) as {
      expo: { ios: { entitlements: Record<string, unknown> } };
    };
    expect(raw.expo.ios.entitlements).toEqual({
      "aps-environment": "production",
      "com.apple.developer.healthkit": true,
    });
  });

  it("never overwrites an entitlement the app.json already declares", () => {
    const app = appWith({ ios: { entitlements: { "aps-environment": "development" } } });
    const added = writeAppEntitlements(app, {
      "aps-environment": "production",
      "com.apple.security.application-groups": ["group.x"],
    });
    expect(added).toEqual(["com.apple.security.application-groups"]);
    const raw = JSON.parse(readFileSync(app.configPath, "utf8")) as {
      expo: { ios: { entitlements: Record<string, unknown> } };
    };
    expect(raw.expo.ios.entitlements["aps-environment"]).toBe("development");
  });

  it("returns [] without writing for a dynamic config", () => {
    const app: AppDescriptor = { name: "dyn", dir: "/tmp/x", configPath: "/tmp/x/app.config.js" };
    expect(writeAppEntitlements(app, { "aps-environment": "production" })).toEqual([]);
  });
});
