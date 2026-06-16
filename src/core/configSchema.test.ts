import { describe, expect, it } from "vitest";
import { loadConfigSchema, validateConfig } from "./configSchema.js";

describe("loadConfigSchema", () => {
  it("loads the committed schema with the LaunchConfigInput root definition", () => {
    const schema = loadConfigSchema();
    expect(schema.$ref).toBe("#/definitions/LaunchConfigInput");
    expect(schema.definitions?.["LaunchConfigInput"]?.required).toEqual(["profiles"]);
  });
});

describe("validateConfig", () => {
  it("accepts a minimal valid config", () => {
    expect(validateConfig({ profiles: { production: { name: "production", sizeBudgetMB: 200 } } })).toEqual([]);
  });

  it("requires profiles", () => {
    const violations = validateConfig({});
    expect(violations).toContainEqual({ path: "profiles", message: "missing required property" });
  });

  it("rejects a bad enum value at its field path", () => {
    const violations = validateConfig({
      profiles: { production: { name: "production" } },
      release: { releaseType: "WHENEVER" },
    });
    expect(violations.some((violation) => violation.path === "release.releaseType")).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    const violations = validateConfig({ profiles: { production: { name: "production" } }, nope: true });
    expect(violations).toContainEqual({ path: "nope", message: "unknown property" });
  });
});
