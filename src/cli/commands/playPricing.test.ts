import { describe, expect, it } from "vitest";
import { formatMoney, parsePrice } from "./playPricing.js";

describe("parsePrice", () => {
  it("splits a decimal amount into units + nanos and upper-cases the currency", () => {
    expect(parsePrice("4.99", "usd")).toEqual({ currencyCode: "USD", units: "4", nanos: 990_000_000 });
  });

  it("handles a whole amount with no fraction (zero-decimal currency)", () => {
    expect(parsePrice("600", "JPY")).toEqual({ currencyCode: "JPY", units: "600", nanos: 0 });
  });

  it("pads the fraction to nanos precision (one decimal place)", () => {
    expect(parsePrice("4.5", "USD")).toEqual({ currencyCode: "USD", units: "4", nanos: 500_000_000 });
  });

  it("accepts the full nine decimal places (single nano)", () => {
    expect(parsePrice("0.000000001", "USD")).toEqual({ currencyCode: "USD", units: "0", nanos: 1 });
  });

  it("strips leading zeros from the whole part", () => {
    expect(parsePrice("007.50", "EUR")).toEqual({ currencyCode: "EUR", units: "7", nanos: 500_000_000 });
  });

  it("rejects a non-3-letter currency", () => {
    expect(() => parsePrice("4.99", "US")).toThrow(/3-letter ISO code/);
    expect(() => parsePrice("4.99", "US1")).toThrow(/3-letter ISO code/);
  });

  it("rejects negative, non-numeric, or over-precise amounts", () => {
    expect(() => parsePrice("-1", "USD")).toThrow(/non-negative decimal/);
    expect(() => parsePrice("4.5x", "USD")).toThrow(/non-negative decimal/);
    expect(() => parsePrice("4.9999999999", "USD")).toThrow(/non-negative decimal/); // 10 decimals
  });

  it("rejects a zero price (nothing to convert)", () => {
    expect(() => parsePrice("0", "USD")).toThrow(/greater than zero/);
    expect(() => parsePrice("0.000000000", "USD")).toThrow(/greater than zero/);
  });
});

describe("formatMoney", () => {
  it("renders two decimals for a sub-unit fraction", () => {
    expect(formatMoney({ currencyCode: "USD", units: "4", nanos: 990_000_000 })).toBe("USD 4.99");
  });

  it("pads a single-digit fraction to two places", () => {
    expect(formatMoney({ currencyCode: "USD", units: "4", nanos: 500_000_000 })).toBe("USD 4.50");
  });

  it("drops the fraction entirely when nanos is zero", () => {
    expect(formatMoney({ currencyCode: "JPY", units: "600", nanos: 0 })).toBe("JPY 600");
  });

  it("keeps full precision for many-decimal nanos", () => {
    expect(formatMoney({ currencyCode: "USD", units: "4", nanos: 123_456_789 })).toBe("USD 4.123456789");
  });
});
