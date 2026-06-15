/**
 * Tests for the glowing pixel-art wordmark. The renderer is pure, so each case asserts on the returned
 * string directly: the half-block glyphs, the embedded color depth, and the plain `none` fallback.
 */

import { describe, it, expect } from "vitest";
import { buildGlowFrames, plainWordmark, renderGlowWordmark } from "./wordmark.js";

/** The ESC byte, built without a raw byte in source, so we can assert ANSI presence/absence. */
const ESC = String.fromCharCode(27);

describe("renderGlowWordmark", () => {
  it("emits truecolor spans, half-block pixels, and the exact letter gradient", () => {
    const out = renderGlowWordmark("truecolor");
    expect(out).toContain(`${ESC}[38;2;`); // truecolor foreground spans
    expect(out).toMatch(/[▀▄]/u); // drawn as half-block pixel art, not text
    expect(out).toContain("248;249;255"); // top-of-letter white from the gradient fill
    expect(out).toContain("198;170;255"); // bottom-of-letter lavender from the gradient fill
  });

  it("downsamples to 256-color when truecolor isn't advertised", () => {
    const out = renderGlowWordmark("ansi256");
    expect(out).toContain(`${ESC}[38;5;`);
    expect(out).not.toContain(`${ESC}[38;2;`);
  });

  it("falls back to plain spaced text with no ANSI under none", () => {
    const out = renderGlowWordmark("none");
    expect(out).not.toContain(ESC);
    expect(out).toBe(plainWordmark());
    expect(out).toContain("L A U N C H");
  });
});

describe("buildGlowFrames", () => {
  it("produces multiple equal-height frames whose glow/shimmer actually changes", () => {
    const frames = buildGlowFrames("truecolor");
    expect(frames.length).toBeGreaterThan(1);
    const heights = new Set(frames.map((frame) => frame.split("\n").length));
    expect(heights.size).toBe(1); // same canvas every frame → clean in-place redraw
    expect(frames[0]).not.toBe(frames[Math.floor(frames.length / 2)]); // it animates
  });

  it("yields a single plain frame under none", () => {
    expect(buildGlowFrames("none")).toEqual([plainWordmark()]);
  });
});
