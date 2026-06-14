/**
 * Tests for export-compliance resolution. The pure helpers (reading the app.json key, the precedence
 * decision) need no mocking; the persistence round-trip runs against a real temp `~/.launch` with the
 * home dir redirected to a throwaway path before `core/paths.js` evaluates.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

// Redirect HOME before any import evaluates `core/paths.js`, so the real `~/.launch/compliance.json`
// resolves under a throwaway dir. node:os `homedir()` honors $HOME / %USERPROFILE%.
const home = vi.hoisted(() => {
  const dir = `${process.env["TMPDIR"] ?? "/tmp"}/launch-compliance-test-${process.pid}`;
  process.env["HOME"] = dir;
  process.env["USERPROFILE"] = dir;
  return { dir };
});

import {
  decideExportCompliance,
  persistCompliance,
  readComplianceFromAppConfig,
  readPersistedCompliance,
  resolveExportCompliance,
} from "./exportCompliance.js";

beforeEach(() => {
  rmSync(home.dir, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(home.dir, { recursive: true, force: true });
});

describe("readComplianceFromAppConfig", () => {
  it("reads ios.config.usesNonExemptEncryption under the expo wrapper", () => {
    expect(readComplianceFromAppConfig({ expo: { ios: { config: { usesNonExemptEncryption: false } } } })).toBe(false);
    expect(readComplianceFromAppConfig({ expo: { ios: { config: { usesNonExemptEncryption: true } } } })).toBe(true);
  });

  it("reads a flat (unwrapped) config too", () => {
    expect(readComplianceFromAppConfig({ ios: { config: { usesNonExemptEncryption: false } } })).toBe(false);
  });

  it("returns undefined when the key is absent, non-boolean, or the config is null", () => {
    expect(readComplianceFromAppConfig(null)).toBeUndefined();
    expect(readComplianceFromAppConfig({ expo: { ios: {} } })).toBeUndefined();
    expect(
      readComplianceFromAppConfig({ expo: { ios: { config: { usesNonExemptEncryption: "no" } } } }),
    ).toBeUndefined();
  });
});

describe("decideExportCompliance — precedence", () => {
  it("prefers the app.json value above all", () => {
    expect(decideExportCompliance({ fromAppConfig: true, fromPersisted: false, interactive: true })).toEqual({
      kind: "use",
      value: true,
      source: "app.json",
    });
  });

  it("falls back to the remembered value when app.json is silent", () => {
    expect(decideExportCompliance({ fromAppConfig: undefined, fromPersisted: false, interactive: false })).toEqual({
      kind: "use",
      value: false,
      source: "remembered",
    });
  });

  it("prompts when nothing is set and we can ask", () => {
    expect(decideExportCompliance({ fromAppConfig: undefined, fromPersisted: undefined, interactive: true })).toEqual({
      kind: "prompt",
    });
  });

  it("errors (with the app.json fix) when nothing is set and we can't ask", () => {
    const decision = decideExportCompliance({
      fromAppConfig: undefined,
      fromPersisted: undefined,
      interactive: false,
    });
    expect(decision.kind).toBe("error");
    if (decision.kind === "error") expect(decision.message).toContain("usesNonExemptEncryption");
  });
});

describe("resolveExportCompliance — prompt + persistence round-trip", () => {
  it("prompts once, persists the answer, then reuses it without asking again", async () => {
    const prompt = vi.fn().mockResolvedValue(false);

    const first = await resolveExportCompliance({
      bundleId: "com.acme.app",
      appConfig: null,
      interactive: true,
      prompt,
    });
    expect(first).toEqual({ usesNonExemptEncryption: false, source: "prompt" });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(readPersistedCompliance("com.acme.app")).toBe(false);

    const second = await resolveExportCompliance({
      bundleId: "com.acme.app",
      appConfig: null,
      interactive: true,
      prompt,
    });
    expect(second).toEqual({ usesNonExemptEncryption: false, source: "remembered" });
    expect(prompt).toHaveBeenCalledTimes(1); // not asked again
  });

  it("app.json wins over a remembered answer", async () => {
    persistCompliance("com.acme.app", true);
    const prompt = vi.fn();
    const resolved = await resolveExportCompliance({
      bundleId: "com.acme.app",
      appConfig: { expo: { ios: { config: { usesNonExemptEncryption: false } } } },
      interactive: true,
      prompt,
    });
    expect(resolved).toEqual({ usesNonExemptEncryption: false, source: "app.json" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("throws in CI when nothing is declared", async () => {
    await expect(
      resolveExportCompliance({
        bundleId: "com.acme.unknown",
        appConfig: null,
        interactive: false,
        prompt: vi.fn(),
      }),
    ).rejects.toThrow(/usesNonExemptEncryption/);
  });
});
