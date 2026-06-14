import { describe, expect, it } from "vitest";
import { asRecord } from "./json.js";

describe("asRecord", () => {
  it("returns a plain object unchanged", () => {
    const value = { a: 1, b: "two" };
    expect(asRecord(value)).toBe(value);
  });

  it("rejects arrays (so a malformed section fails loudly instead of passing as an empty record)", () => {
    expect(asRecord([])).toBeNull();
    expect(asRecord([1, 2, 3])).toBeNull();
  });

  it("rejects null and non-object primitives", () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord("string")).toBeNull();
    expect(asRecord(42)).toBeNull();
    expect(asRecord(true)).toBeNull();
  });
});
