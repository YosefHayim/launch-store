/**
 * Tests for the ASCII banner: the frame-builder and mode selection are pure; the renderer is driven
 * with a capture stub stream and an instant sleep so the animation path runs with no real timers/TTY.
 */

import { describe, it, expect } from "vitest";
import { buildFrames, renderBanner, selectBannerMode, staticBanner, type BannerStream } from "./banner.js";

describe("buildFrames", () => {
  it("produces equal-height frames ending in the LAUNCH wordmark", () => {
    const frames = buildFrames();
    expect(frames.length).toBe(5);
    const heights = new Set(frames.map((frame) => frame.split("\n").length));
    expect(heights.size).toBe(1); // every frame is the same number of lines (clean in-place redraw)
    expect(frames.at(-1)).toContain("L  A  U  N  C  H");
  });

  it("lights both store targets only after the rocket arrives", () => {
    const frames = buildFrames();
    expect(frames[0]).toContain("[ ]"); // not yet delivered
    expect(frames.at(-1)).toContain("[✓]  App Store");
    expect(frames.at(-1)).toContain("Google Play  [✓]");
  });
});

describe("staticBanner", () => {
  it("is the final frame and names both platforms", () => {
    expect(staticBanner()).toContain("App Store");
    expect(staticBanner()).toContain("Google Play");
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

  /** The CSI cursor-up escape `renderBanner` emits between frames (`ESC [ <n> A`), built without a raw byte in source. */
  const cursorUp = `${String.fromCharCode(27)}[`;

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
    expect(output).toContain("ignition…");
    expect(output).toContain("L  A  U  N  C  H");
    expect(output).toContain(cursorUp); // redrew at least once in place
  });
});
