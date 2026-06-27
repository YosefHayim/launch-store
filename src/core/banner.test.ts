/**
 * Tests for the LAUNCH banner orchestration: mode/depth selection are pure; the renderer is driven with
 * a capture stub stream and an instant sleep so the animation path runs with no real timers or TTY. The
 * scene artwork itself (sprites, bloom, frames) is covered in {@link ./rocketScene.test.ts}.
 */

import { describe, it, expect } from 'vitest';
import {
  renderBanner,
  selectBannerMode,
  selectColorDepth,
  staticBanner,
  type BannerStream,
} from './banner.js';

/** The ESC byte, built without a raw byte in source, so we can assert ANSI presence/absence. */
const ESC = String.fromCharCode(27);

/** The CSI cursor-up escape `renderBanner` emits between frames to redraw in place (`ESC [ <n> A`). */
const CURSOR_UP = new RegExp(`${ESC}\\[\\d+A`);

describe('staticBanner', () => {
  it('is the plain-text tagline with no ANSI, for piped output and CI', () => {
    const banner = staticBanner();
    expect(banner).toContain('Launch Store');
    expect(banner).not.toContain(ESC);
  });
});

describe('selectBannerMode', () => {
  it("animates only on an interactive TTY that isn't CI and hasn't opted out", () => {
    expect(selectBannerMode(true, {})).toBe('animate');
    expect(selectBannerMode(false, {})).toBe('static');
    expect(selectBannerMode(true, { CI: '1' })).toBe('static');
    expect(selectBannerMode(true, { LAUNCH_NO_ANIMATION: '1' })).toBe('static');
  });
});

describe('selectColorDepth', () => {
  it('uses truecolor when the terminal advertises it, 256-color by default, and none under NO_COLOR', () => {
    expect(selectColorDepth({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(selectColorDepth({ COLORTERM: '24bit' })).toBe('truecolor');
    expect(selectColorDepth({})).toBe('ansi256');
    expect(selectColorDepth({ NO_COLOR: '1' })).toBe('none');
  });
});

describe('renderBanner', () => {
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

  it("writes a single static frame when stdout isn't a TTY", async () => {
    const { stream, chunks } = capture();
    await renderBanner({ stream, isTTY: false, env: {} });
    expect(chunks.length).toBe(1);
    expect(chunks.join('')).toContain('Launch Store');
    expect(chunks.join('')).not.toMatch(CURSOR_UP); // static path never moves the cursor
  });

  it('animates the rocket scene in place on a truecolor TTY', async () => {
    const { stream, chunks } = capture();
    await renderBanner({
      stream,
      isTTY: true,
      env: { COLORTERM: 'truecolor' },
      sleep: () => Promise.resolve(),
    });
    const output = chunks.join('');
    expect(output).toMatch(/[▀▄]/u); // drawn as half-block pixel art
    expect(output).toContain(`${ESC}[38;2;`); // truecolor glow spans
    expect(output).toMatch(CURSOR_UP); // redrew at least once in place
  });

  it('drops to a plain single frame when NO_COLOR is set (the bloom needs color)', async () => {
    const { stream, chunks } = capture();
    await renderBanner({
      stream,
      isTTY: true,
      env: { NO_COLOR: '1' },
      sleep: () => Promise.resolve(),
    });
    const output = chunks.join('');
    expect(output).toContain('Launch Store');
    expect(output).not.toContain(`${ESC}[38;5;`); // no 256-color spans
    expect(output).not.toContain(`${ESC}[38;2;`); // nor truecolor spans
  });
});
