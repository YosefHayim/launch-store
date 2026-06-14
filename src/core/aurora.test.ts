import { describe, expect, it } from "vitest";
import { AURORA, auroraPaint, colorEnabled, mix, visibleWidth } from "./aurora.js";

/** The ESC byte, built without a raw byte in source, so escape assertions stay greppable. */
const ESC = String.fromCharCode(27);

describe("colorEnabled — only an interactive stdout without NO_COLOR", () => {
  it("is true on a TTY with no NO_COLOR", () => {
    expect(colorEnabled({}, true)).toBe(true);
  });

  it("is false off a TTY (pipes, log files, CI capture)", () => {
    expect(colorEnabled({}, false)).toBe(false);
  });

  it("is false under NO_COLOR even on a TTY", () => {
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
  });
});

describe("mix — linear interpolation between two colors", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(mix(AURORA.violet, AURORA.cyan, 0)).toEqual([...AURORA.violet]);
    expect(mix(AURORA.violet, AURORA.cyan, 1)).toEqual([...AURORA.cyan]);
  });

  it("rounds the midpoint", () => {
    expect(mix([0, 0, 0], [10, 10, 11], 0.5)).toEqual([5, 5, 6]);
  });
});

describe("auroraPaint — truecolor when enabled, identity when not", () => {
  it("emits a 24-bit foreground escape when enabled", () => {
    const paint = auroraPaint(true);
    expect(paint.enabled).toBe(true);
    expect(paint.fg(AURORA.cyan, "x")).toBe(`${ESC}[38;2;34;211;238mx${ESC}[0m`);
  });

  it("returns text untouched when disabled", () => {
    const paint = auroraPaint(false);
    expect(paint.enabled).toBe(false);
    expect(paint.fg(AURORA.cyan, "x")).toBe("x");
    expect(paint.bold("x")).toBe("x");
    expect(paint.gradient("xy", AURORA.violet, AURORA.cyan)).toBe("xy");
  });

  it("paints each non-space character of a gradient between the two endpoints", () => {
    const out = auroraPaint(true).gradient("ab", AURORA.violet, AURORA.cyan);
    expect(out).toContain("38;2;167;139;250"); // first char = violet endpoint
    expect(out).toContain("38;2;34;211;238"); // last char = cyan endpoint
  });
});

describe("visibleWidth — ignores ANSI escapes", () => {
  it("counts only printable characters", () => {
    expect(visibleWidth(`${ESC}[38;2;1;2;3mhi${ESC}[0m`)).toBe(2);
    expect(visibleWidth("plain")).toBe(5);
  });
});
