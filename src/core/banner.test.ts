/**
 * Tests for the ASCII banner: the frame-builder and mode selection are pure; the renderer is driven
 * with a capture stub stream and an instant sleep so the animation path runs with no real timers/TTY.
 */

import { describe, it, expect } from "vitest";
import {
  buildFrames,
  renderBanner,
  selectBannerMode,
  selectColorDepth,
  staticBanner,
  type BannerStream,
} from "./banner.js";

/** The ESC byte, built without a raw byte in source, so we can assert ANSI presence/absence. */
const ESC = String.fromCharCode(27);

/** Strip ANSI SGR sequences so an assertion on the visible text isn't broken by per-glyph color spans. */
function stripAnsi(text: string): string {
  return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
}

describe("buildFrames", () => {
  it("produces equal-height frames ending in the LAUNCH wordmark", () => {
    const frames = buildFrames();
    expect(frames.length).toBe(27);
    const heights = new Set(frames.map((frame) => frame.split("\n").length));
    expect(heights.size).toBe(1); // every frame is the same number of lines (clean in-place redraw)
    expect(frames.at(-1)).toContain("L  A  U  N  C  H");
  });

  it("lights both store targets only after the rocket strikes", () => {
    const frames = buildFrames();
    expect(frames[0]).toContain("App Store");
    expect(frames[0]).not.toContain("✓"); // not yet delivered while it climbs
    expect(frames.at(-1)).toContain("✓ App Store");
    expect(frames.at(-1)).toContain("✓ Google Play");
  });

  it("embeds color codes only when color is requested, matching the depth", () => {
    expect(buildFrames("ansi256").join("")).toContain(`${ESC}[38;5;`);
    expect(buildFrames("truecolor").join("")).toContain(`${ESC}[38;2;`);
    expect(buildFrames("none").join("")).not.toContain(ESC);
  });

  it("paints the Google Play mark in its four exact brand facets once lit", () => {
    const litFrame = buildFrames("truecolor").at(-1) ?? "";
    // The real Google brand hexes — blue #4285F4, green #34A853, red #EA4335, yellow #FBBC04 — as RGB.
    expect(litFrame).toContain("66;133;244");
    expect(litFrame).toContain("52;168;83");
    expect(litFrame).toContain("234;67;53");
    expect(litFrame).toContain("251;188;4");
  });
});

describe("staticBanner", () => {
  it("is the final frame, names both platforms, and is plain (no ANSI)", () => {
    const banner = staticBanner();
    expect(banner).toContain("App Store");
    expect(banner).toContain("Google Play");
    expect(banner).toContain("L  A  U  N  C  H");
    expect(banner).not.toContain(ESC);
  });
});

describe("selectBannerMode", () => {
  it("animates only on an interactive TTY that isn't CI and hasn't opted out", () => {
    expect(selectBannerMode(true, {})).toBe("animate");
    expect(selectBannerMode(false, {})).toBe("static");
    expect(selectBannerMode(true, { CI: "1" })).toBe("static");
    expect(selectBannerMode(true, { LAUNCH_NO_ANIMATION: "1" })).toBe("static");
  });
});

describe("selectColorDepth", () => {
  it("uses truecolor when the terminal advertises it, 256-color by default, and none under NO_COLOR", () => {
    expect(selectColorDepth({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(selectColorDepth({ COLORTERM: "24bit" })).toBe("truecolor");
    expect(selectColorDepth({})).toBe("ansi256");
    expect(selectColorDepth({ NO_COLOR: "1" })).toBe("none");
  });
});

describe("renderBanner", () => {
  function capture(): { stream: BannerStream; chunks: string[] } {
    const chunks: string[] = [];
    return {
      chunks,
      stream: {
        write(chunk) {
          chunks.push(chunk);
          return true;
        },
      },
    };
  }

  /** The CSI cursor-up escape `renderBanner` emits between frames (`ESC [ <n> A`). */
  const cursorUp = `${ESC}[`;

  it("writes a single static frame when stdout isn't a TTY", async () => {
    const { stream, chunks } = capture();
    await renderBanner({ stream, isTTY: false, env: {} });
    expect(chunks.length).toBe(1);
    expect(chunks.join("")).toContain("L  A  U  N  C  H");
    expect(chunks.join("")).not.toContain(cursorUp); // static path never moves the cursor
  });

  it("animates every frame in place on a TTY (cursor-up between frames)", async () => {
    const { stream, chunks } = capture();
    await renderBanner({ stream, isTTY: true, env: {}, sleep: () => Promise.resolve() });
    const output = chunks.join("");
    expect(stripAnsi(output)).toContain("ignition…");
    expect(stripAnsi(output)).toContain("L  A  U  N  C  H");
    expect(output).toContain(cursorUp); // redrew at least once in place
  });

  it("drops color when NO_COLOR is set but still animates", async () => {
    const { stream, chunks } = capture();
    await renderBanner({ stream, isTTY: true, env: { NO_COLOR: "1" }, sleep: () => Promise.resolve() });
    const output = chunks.join("");
    expect(output).toContain("ignition…");
    expect(output).toContain(cursorUp); // still animating (cursor-up is not a color code)
    expect(output).not.toContain(`${ESC}[38;5;`); // ...but no 256-color spans
    expect(output).not.toContain(`${ESC}[38;2;`); // ...nor truecolor spans
  });
});
