/**
 * Tests for the rocket-scene artwork: the renderers are pure (depth in, string out), so these assert the
 * plain-text fallback, that truecolor frames are half-block pixel art with truecolor spans, that every
 * animation frame is the same height (so {@link ./banner.ts} can redraw in place), and that the animation
 * rests on the settled still.
 */

import { describe, it, expect } from "vitest";
import { buildRocketFrames, renderRocketBanner, plainRocketBanner } from "./rocketScene.js";

/** The ESC byte, built without a raw byte in source, so we can assert ANSI presence/absence. */
const ESC = String.fromCharCode(27);

describe("plainRocketBanner", () => {
  it("is the plain-text tagline with no ANSI", () => {
    expect(plainRocketBanner()).toContain("Launch Store");
    expect(plainRocketBanner()).not.toContain(ESC);
  });
});

describe("renderRocketBanner", () => {
  it("returns the plain tagline under 'none'", () => {
    expect(renderRocketBanner("none")).toBe(plainRocketBanner());
  });

  it("renders a colored half-block still under truecolor", () => {
    const still = renderRocketBanner("truecolor");
    expect(still).toMatch(/[▀▄█]/u); // half-block pixel art
    expect(still).toContain(`${ESC}[38;2;`); // truecolor spans
  });
});

describe("buildRocketFrames", () => {
  it("yields a single plain frame under 'none' (the bloom and logos need color)", () => {
    expect(buildRocketFrames("none")).toEqual([plainRocketBanner()]);
  });

  it("animates many same-height frames and rests on the settled still (truecolor)", () => {
    const frames = buildRocketFrames("truecolor");
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]).toMatch(/[▀▄█]/u);
    expect(frames[0]).toContain(`${ESC}[38;2;`);

    const height = (frames[0] ?? "").split("\n").length;
    for (const frame of frames) expect(frame.split("\n").length).toBe(height);

    expect(frames[frames.length - 1]).toBe(renderRocketBanner("truecolor"));
  });
});
