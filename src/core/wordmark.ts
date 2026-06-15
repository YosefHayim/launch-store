/**
 * The glowing pixel-art "LAUNCH" wordmark — the brand logotype, drawn from scratch as half-block
 * pixels with a neon purple bloom.
 *
 * This is offered as an **adoptable style** alongside the existing {@link import("./banner.js")}
 * wordmark (which renders the plain spaced text `L A U N C H` under a violet→cyan gradient). Where the
 * banner stamps discrete colored cells, this renders the letters into a tiny RGB pixmap first — so the
 * bloom is a real additive halo that fades smoothly around the strokes — then folds the pixel rows into
 * the same half-block `▀`/`▄`/`█` cells the banner uses, so the OUTPUT format is identical: truecolor
 * where advertised, downsampled to 256-color otherwise, and a plain-text fallback under `NO_COLOR`.
 * The letters are authored upright and sheared at render time into the italic, blade-styled lean of the
 * brand mark, filled with a white→lavender vertical gradient.
 *
 * It reuses {@link Cell}, {@link Rgb}, and {@link renderBuffer} from the banner so there's one
 * half-block renderer, not two. To adopt it in the live banner, render a frame here in place of the
 * text wordmark (see the PR notes), or play {@link buildGlowFrames} the way `renderBanner` plays its
 * own frames.
 */

import { renderBuffer, type Cell, type ColorDepth, type Rgb } from "./banner.js";

/** Source height in pixel rows of every glyph. Kept even so each cell pairs two pixel rows cleanly. */
const LOGO_H = 14;

/**
 * The six LAUNCH letters as upright bold bitmaps ('X' = lit, anything else transparent). They're
 * authored straight; {@link SHEAR} leans them into italic at render time so the grids stay readable.
 */
const GLYPHS: Record<string, readonly string[]> = {
  L: [
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XX.....",
    "XXXXXX.",
    "XXXXXXX",
  ],
  A: [
    "...XX....",
    "...XX....",
    "..XXXX...",
    "..XXXX...",
    "..X..X...",
    ".XX..XX..",
    ".XX..XX..",
    ".XXXXXX..",
    ".XXXXXX..",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
  ],
  U: [
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XXX..XXX.",
    ".XXXXXX..",
    "..XXXX...",
  ],
  N: [
    "XX....XX.",
    "XXX...XX.",
    "XXXX..XX.",
    "XXXX..XX.",
    "XX.X..XX.",
    "XX.XX.XX.",
    "XX.XX.XX.",
    "XX..X.XX.",
    "XX..XXXX.",
    "XX..XXXX.",
    "XX...XXX.",
    "XX...XXX.",
    "XX....XX.",
    "XX....XX.",
  ],
  C: [
    ".XXXXXX.",
    "XXXXXXXX",
    "XX....XX",
    "XX......",
    "XX......",
    "XX......",
    "XX......",
    "XX......",
    "XX......",
    "XX......",
    "XX....XX",
    "XXXXXXXX",
    ".XXXXXX.",
    "........",
  ],
  H: [
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XXXXXXXX.",
    "XXXXXXXX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
    "XX....XX.",
  ],
};

const WORD = "LAUNCH";
const SHEAR = 0.32; // italic lean: every row is shifted right by (rowsFromBottom) * SHEAR pixels
const GAP = 1; // blank pixel columns between letters
const PAD_X = 4; // horizontal pixel margin so the bloom isn't clipped
const PAD_Y = 2; // vertical pixel margin (kept even to preserve clean half-block pairing)
const EMIT_THRESHOLD = 22; // a pixel below this summed brightness is transparent (keeps the halo shaped)
const BLOOM_RADIUS = 3; // how far (pixels) the additive glow reaches around each lit stroke pixel

const FILL_TOP: Rgb = [248, 249, 255]; // letter gradient — top (near-white)
const FILL_BOTTOM: Rgb = [198, 170, 255]; // letter gradient — bottom (lavender)
const HIGHLIGHT: Rgb = [255, 255, 255]; // the sweeping shimmer color
const GLOW: Rgb = [138, 96, 255]; // the purple bloom around the letters

/** Plain-text fallback shown for `NO_COLOR`/piped output — matches the banner's spaced wordmark. */
const PLAIN = "L A U N C H";

/** A lit source pixel after shearing: its integer pixmap position and its gradient color. */
interface LitPixel {
  x: number;
  y: number;
  color: Rgb;
}

/** Linear-interpolate two colors at `t` (0→a, 1→b), rounded to 8-bit channels. */
function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * A small additive RGB canvas. The bloom accumulates here (overlapping discs sum to a smooth halo),
 * the letters are written opaque on top, then {@link colorAt} reports each pixel — or `undefined` when
 * it's too dim to draw, which is what shapes the glow instead of filling a rectangle.
 */
class Pixmap {
  readonly w: number;
  readonly h: number;
  private readonly buf: Float64Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Float64Array(w * h * 3);
  }

  /** Add light (the bloom): accumulate `color * alpha` into a pixel. */
  add(x: number, y: number, color: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || alpha <= 0) return;
    const o = (y * this.w + x) * 3;
    this.buf[o] = (this.buf[o] ?? 0) + color[0] * alpha;
    this.buf[o + 1] = (this.buf[o + 1] ?? 0) + color[1] * alpha;
    this.buf[o + 2] = (this.buf[o + 2] ?? 0) + color[2] * alpha;
  }

  /** Write an opaque pixel (the crisp letter fill), overwriting whatever bloom was under it. */
  set(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.buf[o] = color[0];
    this.buf[o + 1] = color[1];
    this.buf[o + 2] = color[2];
  }

  /** The clamped color at a pixel, or `undefined` if it's below the emit threshold (transparent). */
  colorAt(x: number, y: number): Rgb | undefined {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return undefined;
    const o = (y * this.w + x) * 3;
    const r = Math.min(255, this.buf[o] ?? 0);
    const g = Math.min(255, this.buf[o + 1] ?? 0);
    const b = Math.min(255, this.buf[o + 2] ?? 0);
    if (r + g + b < EMIT_THRESHOLD) return undefined;
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
}

/** Lay out the word: every lit glyph pixel, sheared into italic and shifted into a padded pixmap space. */
function layout(): { pixels: LitPixel[]; width: number; height: number } {
  const lean: { x: number; y: number; k: number }[] = [];
  let cursor = 0;
  for (const ch of WORD) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const glyphWidth = glyph[0]?.length ?? 0;
    for (let gy = 0; gy < LOGO_H; gy++) {
      const row = glyph[gy] ?? "";
      for (let gx = 0; gx < glyphWidth; gx++) {
        if (row.charAt(gx) !== "X") continue;
        lean.push({ x: Math.round(cursor + gx + (LOGO_H - 1 - gy) * SHEAR), y: gy, k: gy / (LOGO_H - 1) });
      }
    }
    cursor += glyphWidth + GAP;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of lean) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!Number.isFinite(minX)) return { pixels: [], width: 0, height: 0 };

  const pixels = lean.map((p) => ({ x: p.x - minX + PAD_X, y: p.y + PAD_Y, color: lerp(FILL_TOP, FILL_BOTTOM, p.k) }));
  return { pixels, width: maxX - minX + 1 + PAD_X * 2, height: LOGO_H + PAD_Y * 2 };
}

/** Paint the wordmark into a pixmap: additive bloom under the strokes, then the crisp gradient letters. */
function paintWordmark(pm: Pixmap, pixels: readonly LitPixel[], glow: number, sweep: number | null): void {
  for (const p of pixels) {
    for (let dy = -BLOOM_RADIUS; dy <= BLOOM_RADIUS; dy++) {
      for (let dx = -BLOOM_RADIUS; dx <= BLOOM_RADIUS; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > BLOOM_RADIUS) continue;
        pm.add(p.x + dx, p.y + dy, GLOW, glow * 0.9 * (1 - d / BLOOM_RADIUS) ** 2);
      }
    }
  }
  for (const p of pixels) {
    let color = p.color;
    if (sweep !== null) {
      const distance = Math.abs(p.x - sweep);
      if (distance < 1.5) color = lerp(color, HIGHLIGHT, 1 - distance / 1.5);
    }
    pm.set(p.x, p.y, color);
  }
}

/** Fold a pixmap's pixel-row pairs into half-block cells: `▀` top, `▄` bottom, `█` both, space if dim. */
function fold(pm: Pixmap): Cell[][] {
  const rows: Cell[][] = [];
  for (let cr = 0; cr * 2 < pm.h; cr++) {
    const row: Cell[] = [];
    for (let x = 0; x < pm.w; x++) {
      const top = pm.colorAt(x, cr * 2);
      const bottom = pm.colorAt(x, cr * 2 + 1);
      if (top && bottom) row.push({ ch: "▀", fg: top, bg: bottom });
      else if (top) row.push({ ch: "▀", fg: top });
      else if (bottom) row.push({ ch: "▄", fg: bottom });
      else row.push({ ch: " " });
    }
    rows.push(row);
  }
  return rows;
}

/** Render one frame at a given glow level and optional shimmer column. */
function renderFrame(depth: ColorDepth, glow: number, sweep: number | null): string {
  const { pixels, width, height } = layout();
  if (pixels.length === 0) return "";
  const pm = new Pixmap(width, height);
  paintWordmark(pm, pixels, glow, sweep);
  return renderBuffer(fold(pm), depth);
}

/** How many frames {@link buildGlowFrames} emits for one breathe + shimmer cycle. */
const FRAME_COUNT = 24;

/**
 * The settled glowing wordmark as a single frame — for static/piped output, logs, or a still header.
 * `none` returns the plain spaced text (a bloom can't render without color).
 */
export function renderGlowWordmark(depth: ColorDepth): string {
  return depth === "none" ? PLAIN : renderFrame(depth, 0.85, null);
}

/**
 * The animation frames — the bloom breathes (sinusoidal glow) while a white shimmer sweeps across.
 * Every frame is the same size, so a caller can redraw in place like `renderBanner` does. `none`
 * yields a single plain-text frame since the effect needs color.
 */
export function buildGlowFrames(depth: ColorDepth): string[] {
  if (depth === "none") return [PLAIN];
  const { width } = layout();
  const frames: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const phase = i / FRAME_COUNT;
    const glow = 0.55 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 2));
    frames.push(renderFrame(depth, glow, -3 + phase * (width + 6)));
  }
  return frames;
}

/** The plain-text wordmark used for the `none`/`NO_COLOR` path, exported for callers and tests. */
export function plainWordmark(): string {
  return PLAIN;
}
