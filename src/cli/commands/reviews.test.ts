import { describe, expect, it } from "vitest";
import { parseRating } from "./reviews.js";

describe("parseRating", () => {
  it("returns undefined when the flag is absent", () => {
    expect(parseRating(undefined)).toBeUndefined();
  });

  it("accepts whole numbers 1–5", () => {
    expect(parseRating("1")).toBe(1);
    expect(parseRating("5")).toBe(5);
    expect(parseRating(" 3 ")).toBe(3);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseRating("0")).toThrow(/1–5/);
    expect(() => parseRating("6")).toThrow(/1–5/);
  });

  it("rejects non-numeric input instead of silently truncating it", () => {
    // Number.parseInt("3x") would yield 3 and filter wrongly — the strict check must reject these.
    expect(() => parseRating("3x")).toThrow(/1–5/);
    expect(() => parseRating("abc")).toThrow(/1–5/);
    expect(() => parseRating("3.5")).toThrow(/1–5/);
  });
});
