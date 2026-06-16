import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDescriptor } from "../types.js";
import { migrateEas, parseEasJson } from "./eas.js";
import type { MigrationArtifact, MigrationNote, MigrationNoteLevel } from "./types.js";

/** A realistic eas.json covering build profiles, env, submit credentials, and the cli block. */
const SAMPLE_EAS = JSON.stringify({
  cli: { appVersionSource: "remote" },
  build: {
    development: {
      developmentClient: true,
      distribution: "internal",
      channel: "development",
      env: { API_URL: "https://dev" },
    },
    production: { channel: "production", env: { API_URL: "https://prod", SENTRY_DSN: "x" }, autoIncrement: true },
  },
  submit: {
    production: {
      ios: { appleId: "you@example.com", ascAppId: "123", appleTeamId: "ABCD" },
      android: { serviceAccountKeyPath: "./play-key.json", track: "internal" },
    },
  },
});

/** A minimal app descriptor, overridable per field. */
function app(over: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name: "alpha", dir: "/tmp", configPath: "/tmp/app.json", bundleId: "com.acme.alpha", ...over };
}

/** The artifact at `path`, asserting it was emitted. */
function artifact(artifacts: MigrationArtifact[], path: string): MigrationArtifact {
  const found = artifacts.find((entry) => entry.path === path);
  expect(found, `expected artifact ${path}`).toBeDefined();
  return found!;
}

/** Notes at a given level. */
function notesAt(notes: MigrationNote[], level: MigrationNoteLevel): MigrationNote[] {
  return notes.filter((note) => note.level === level);
}

describe("parseEasJson", () => {
  it("parses build, submit, and cli into the narrowed shape", () => {
    const eas = parseEasJson(SAMPLE_EAS);
    expect(Object.keys(eas.build).sort()).toEqual(["development", "production"]);
    expect(eas.build["production"]?.env).toEqual({ API_URL: "https://prod", SENTRY_DSN: "x" });
    expect(eas.build["development"]?.distribution).toBe("internal");
    expect(eas.submit["production"]?.android?.track).toBe("internal");
    expect(eas.cli?.appVersionSource).toBe("remote");
  });

  it("defaults missing sections rather than failing", () => {
    const eas = parseEasJson("{}");
    expect(eas).toEqual({ build: {}, submit: {} });
  });

  it("drops non-string env values and empty halves", () => {
    const eas = parseEasJson(JSON.stringify({ build: { p: { env: { A: "1", B: 2 } } }, submit: { p: { ios: {} } } }));
    expect(eas.build["p"]?.env).toEqual({ A: "1" });
    expect(eas.submit["p"]?.ios).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseEasJson("{ not json")).toThrow(/not valid JSON/);
  });

  it("throws on a non-object document", () => {
    expect(() => parseEasJson('"a string"')).toThrow(/must be a JSON object/);
  });
});

describe("migrateEas", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "launch-migrate-"));
    writeFileSync(join(dir, "eas.json"), SAMPLE_EAS);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when there is no eas.json", () => {
    rmSync(join(dir, "eas.json"));
    expect(() => migrateEas(dir, [app()])).toThrow(/No eas.json/);
  });

  it("emits launch.config.ts carrying every EAS build profile", () => {
    const result = migrateEas(dir, [app()]);
    const config = artifact(result.artifacts, "launch.config.ts").contents;
    expect(config).toContain('"development"');
    expect(config).toContain('"production"');
    expect(config).toContain("defineConfig");
  });

  it("lifts the Play track from the matching submit profile onto the build profile", () => {
    const config = artifact(migrateEas(dir, [app()]).artifacts, "launch.config.ts").contents;
    expect(config).toContain('"track": "internal"');
  });

  it("collects env keys (sorted, values blanked) into .env.example", () => {
    const env = artifact(migrateEas(dir, [app()]).artifacts, ".env.example").contents;
    expect(env).toContain("API_URL=");
    expect(env).toContain("SENTRY_DSN=");
    expect(env).not.toContain("https://prod");
  });

  it("scaffolds store.config.json when absent and notes it as manual", () => {
    const result = migrateEas(dir, [app()]);
    expect(result.artifacts.map((a) => a.path)).toContain("store.config.json");
    const manual = notesAt(result.notes, "manual").map((n) => n.message);
    expect(manual.some((m) => m.includes("store.config.json"))).toBe(true);
  });

  it("skips store.config.json when one already exists", () => {
    writeFileSync(join(dir, "store.config.json"), "{}");
    const result = migrateEas(dir, [app()]);
    expect(result.artifacts.map((a) => a.path)).not.toContain("store.config.json");
    expect(notesAt(result.notes, "skipped").some((n) => n.message.includes("store.config.json"))).toBe(true);
  });

  it("reports EAS Update channels, internal distribution, and submit credentials as manual", () => {
    const manual = notesAt(migrateEas(dir, [app()]).notes, "manual").map((n) => n.message);
    expect(manual.some((m) => m.includes("channel"))).toBe(true);
    expect(manual.some((m) => m.includes("internal (ad-hoc) distribution"))).toBe(true);
    expect(manual.some((m) => m.includes("Apple account details"))).toBe(true);
    expect(manual.some((m) => m.includes("Play service account"))).toBe(true);
  });

  it("reports remote appVersionSource and detected ids as non-manual", () => {
    const result = migrateEas(dir, [app({ packageName: "com.acme.alpha" })]);
    expect(notesAt(result.notes, "mapped").some((n) => n.message.includes("appVersionSource"))).toBe(true);
    const info = notesAt(result.notes, "info").map((n) => n.message);
    expect(info.some((m) => m.includes("com.acme.alpha") && m.includes("bundle id"))).toBe(true);
    expect(info.some((m) => m.includes("com.acme.alpha") && m.includes("package"))).toBe(true);
  });

  it("falls back to a single production profile when eas.json declares none", () => {
    writeFileSync(join(dir, "eas.json"), JSON.stringify({ submit: {} }));
    const config = artifact(migrateEas(dir, [app()]).artifacts, "launch.config.ts").contents;
    expect(config).toContain('"production"');
  });
});
