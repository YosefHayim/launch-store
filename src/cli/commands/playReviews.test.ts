import { describe, expect, it } from "vitest";
import { parseRating } from "./playReviews.js";

describe("parseRating", () => {
  it("returns undefined when the flag is absent", () => {
    expect(parseRating(undefined)).toBeUndefined();
  });

  it("accepts whole numbers 1–5", () => {
    expect(parseRating("1")).toBe(1);
    expect(parseRating("5")).toBe(5);
    expect(parseRating(" 3 ")).toBe(3);
  });

  it("rejects out-of-range and non-numeric input instead of silently truncating", () => {
    expect(() => parseRating("0")).toThrow(/1–5/);
    expect(() => parseRating("6")).toThrow(/1–5/);
    expect(() => parseRating("3x")).toThrow(/1–5/);
    expect(() => parseRating("3.5")).toThrow(/1–5/);
  });
});
