import { describe, expect, it } from "vitest";
import { resolveMetrics, resolveDays } from "./playReports.js";
import { DEFAULT_VITALS_DAYS } from "../../google/playReporting.js";

describe("resolveMetrics", () => {
  it("shows both vitals when no --metric flag is given", () => {
    expect(resolveMetrics(undefined)).toEqual(["crash", "anr"]);
  });

  it("narrows to a single vital, case-insensitively", () => {
    expect(resolveMetrics("crash")).toEqual(["crash"]);
    expect(resolveMetrics(" ANR ")).toEqual(["anr"]);
  });

  it("rejects an unknown metric with an actionable error", () => {
    expect(() => resolveMetrics("ratings")).toThrow(/crash.*anr/);
    expect(() => resolveMetrics("slow-start")).toThrow(/crash.*anr/);
  });
});

describe("resolveDays", () => {
  it("defaults to the standard window when absent", () => {
    expect(resolveDays(undefined)).toBe(DEFAULT_VITALS_DAYS);
  });

  it("accepts a positive whole number", () => {
    expect(resolveDays("7")).toBe(7);
    expect(resolveDays(" 90 ")).toBe(90);
  });

  it("rejects zero, negatives, and non-integers", () => {
    expect(() => resolveDays("0")).toThrow(/positive whole number/);
    expect(() => resolveDays("-3")).toThrow(/positive whole number/);
    expect(() => resolveDays("7.5")).toThrow(/positive whole number/);
    expect(() => resolveDays("lots")).toThrow(/positive whole number/);
  });
});
