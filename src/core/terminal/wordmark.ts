import { renderBuffer, type Cell, type ColorDepth, type Rgb } from './halfblock.js';
/** Source height in pixel rows of every glyph. Kept even so each cell pairs two pixel rows cleanly. */
const LOGO_H = 14;
/**
 * The six LAUNCH letters as upright bold bitmaps ('X' = lit, anything else transparent). They're
 * authored straight; {@link SHEAR} leans them into italic at render time so the grids stay readable.
 */
const GLYPHS: Record<string, readonly string[]> = {
  L: [
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XX.....',
    'XXXXXX.',
    'XXXXXXX',
  ],
  A: [
    '...XX....',
    '...XX....',
    '..XXXX...',
    '..XXXX...',
    '..X..X...',
    '.XX..XX..',
    '.XX..XX..',
    '.XXXXXX..',
    '.XXXXXX..',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
  ],
  U: [
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XXX..XXX.',
    '.XXXXXX..',
    '..XXXX...',
  ],
  N: [
    'XX....XX.',
    'XXX...XX.',
    'XXXX..XX.',
    'XXXX..XX.',
    'XX.X..XX.',
    'XX.XX.XX.',
    'XX.XX.XX.',
    'XX..X.XX.',
    'XX..XXXX.',
    'XX..XXXX.',
    'XX...XXX.',
    'XX...XXX.',
    'XX....XX.',
    'XX....XX.',
  ],
  C: [
    '.XXXXXX.',
    'XXXXXXXX',
    'XX....XX',
    'XX......',
    'XX......',
    'XX......',
    'XX......',
    'XX......',
    'XX......',
    'XX......',
    'XX....XX',
    'XXXXXXXX',
    '.XXXXXX.',
    '........',
  ],
  H: [
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XXXXXXXX.',
    'XXXXXXXX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
    'XX....XX.',
  ],
};
const WORD = 'LAUNCH';
const SHEAR = 0.32;
const GAP = 1;
const PAD_X = 4;
const PAD_Y = 2;
const EMIT_THRESHOLD = 22;
const BLOOM_RADIUS = 3;
const FILL_TOP: Rgb = [248, 249, 255];
const FILL_BOTTOM: Rgb = [198, 170, 255];
const HIGHLIGHT: Rgb = [255, 255, 255];
const GLOW: Rgb = [138, 96, 255];
/** Plain-text fallback shown for `NO_COLOR`/piped output - matches the banner's spaced wordmark. */
const PLAIN = 'L A U N C H';
/** A lit source pixel after shearing: its integer pixmap position and its gradient color. */
type LitPixel = {
  x: number;
  y: number;
  color: Rgb;
};
/** Linear-interpolate two colors at `t` (0->a, 1->b), rounded to 8-bit channels. */
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
};
/**
 * A small additive RGB canvas. The bloom accumulates here (overlapping discs sum to a smooth halo),
 * the letters are written opaque on top, then {@link colorAt} reports each pixel - or `undefined` when
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
    if (x < 0) return;
    if (y < 0) return;
    if (x >= this.w) return;
    if (y >= this.h) return;
    if (alpha <= 0) return;
    const channelOffset = (y * this.w + x) * 3;
    let redBrightness = this.buf[channelOffset];
    if (redBrightness === undefined) redBrightness = 0;
    let greenBrightness = this.buf[channelOffset + 1];
    if (greenBrightness === undefined) greenBrightness = 0;
    let blueBrightness = this.buf[channelOffset + 2];
    if (blueBrightness === undefined) blueBrightness = 0;
    this.buf[channelOffset] = redBrightness + color[0] * alpha;
    this.buf[channelOffset + 1] = greenBrightness + color[1] * alpha;
    this.buf[channelOffset + 2] = blueBrightness + color[2] * alpha;
  }
  /** Write an opaque pixel (the crisp letter fill), overwriting whatever bloom was under it. */
  set(x: number, y: number, color: Rgb): void {
    if (x < 0) return;
    if (y < 0) return;
    if (x >= this.w) return;
    if (y >= this.h) return;
    const channelOffset = (y * this.w + x) * 3;
    this.buf[channelOffset] = color[0];
    this.buf[channelOffset + 1] = color[1];
    this.buf[channelOffset + 2] = color[2];
  }
  /** The clamped color at a pixel, or `undefined` if it's below the emit threshold (transparent). */
  colorAt(x: number, y: number): Rgb | undefined {
    if (x < 0) return undefined;
    if (y < 0) return undefined;
    if (x >= this.w) return undefined;
    if (y >= this.h) return undefined;
    const channelOffset = (y * this.w + x) * 3;
    let redBrightness = this.buf[channelOffset];
    if (redBrightness === undefined) redBrightness = 0;
    let greenBrightness = this.buf[channelOffset + 1];
    if (greenBrightness === undefined) greenBrightness = 0;
    let blueBrightness = this.buf[channelOffset + 2];
    if (blueBrightness === undefined) blueBrightness = 0;
    const clampedRed = Math.min(255, redBrightness);
    const clampedGreen = Math.min(255, greenBrightness);
    const clampedBlue = Math.min(255, blueBrightness);
    if (clampedRed + clampedGreen + clampedBlue < EMIT_THRESHOLD) return undefined;
    return [Math.round(clampedRed), Math.round(clampedGreen), Math.round(clampedBlue)];
  }
}
/** Lay out the word: every lit glyph pixel, sheared into italic and shifted into a padded pixmap space. */
const layout = (): {
  pixels: LitPixel[];
  width: number;
  height: number;
} => {
  const lean: {
    x: number;
    y: number;
    k: number;
  }[] = [];
  let cursor = 0;
  for (const ch of WORD) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    const firstGlyphRow = glyph[0];
    if (firstGlyphRow === undefined) continue;
    const glyphWidth = firstGlyphRow.length;
    for (let gy = 0; gy < LOGO_H; gy++) {
      const glyphRow = glyph[gy];
      if (glyphRow === undefined) continue;
      for (let gx = 0; gx < glyphWidth; gx++) {
        if (glyphRow.charAt(gx) !== 'X') continue;
        lean.push({
          x: Math.round(cursor + gx + (LOGO_H - 1 - gy) * SHEAR),
          y: gy,
          k: gy / (LOGO_H - 1),
        });
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
  const pixels = lean.map((p) => ({
    x: p.x - minX + PAD_X,
    y: p.y + PAD_Y,
    color: lerp(FILL_TOP, FILL_BOTTOM, p.k),
  }));
  return { pixels, width: maxX - minX + 1 + PAD_X * 2, height: LOGO_H + PAD_Y * 2 };
};
/** Paint the wordmark into a pixmap: additive bloom under the strokes, then the crisp gradient letters. */
const paintWordmark = (
  pm: Pixmap,
  pixels: readonly LitPixel[],
  glow: number,
  sweep: number | null,
): void => {
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
};
/** Convert paired pixel rows into ASCII terminal cells. */
const fold = (pm: Pixmap): Cell[][] => {
  const rows: Cell[][] = [];
  for (let cr = 0; cr * 2 < pm.h; cr++) {
    const cellRow: Cell[] = [];
    for (let x = 0; x < pm.w; x++) {
      const top = pm.colorAt(x, cr * 2);
      const bottom = pm.colorAt(x, cr * 2 + 1);
      if (top && bottom) cellRow.push({ ch: '#', fg: top, bg: bottom });
      else if (top) cellRow.push({ ch: '^', fg: top });
      else if (bottom) cellRow.push({ ch: '_', fg: bottom });
      else cellRow.push({ ch: ' ' });
    }
    rows.push(cellRow);
  }
  return rows;
};
/** Render one frame at a given glow level and optional shimmer column. */
const renderFrame = (depth: ColorDepth, glow: number, sweep: number | null): string => {
  const { pixels, width, height } = layout();
  if (pixels.length === 0) return '';
  const pm = new Pixmap(width, height);
  paintWordmark(pm, pixels, glow, sweep);
  return renderBuffer(fold(pm), depth);
};
/** How many frames {@link buildGlowFrames} emits for one breathe + shimmer cycle. */
const FRAME_COUNT = 24;
/**
 * The settled glowing wordmark as a single frame - for static/piped output, logs, or a still header.
 * `none` returns the plain spaced text (a bloom can't render without color).
 */
export const renderGlowWordmark = (depth: ColorDepth): string => {
  if (depth === 'none') return PLAIN;
  return renderFrame(depth, 0.85, null);
};
/**
 * The animation frames - the bloom breathes (sinusoidal glow) while a white shimmer sweeps across.
 * Every frame is the same size, so a caller can redraw in place like `renderBanner` does. `none`
 * yields a single plain-text frame since the effect needs color.
 */
export const buildGlowFrames = (depth: ColorDepth): string[] => {
  if (depth === 'none') return [PLAIN];
  const { width } = layout();
  const frames: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const phase = i / FRAME_COUNT;
    const glow = 0.55 + 0.45 * Math.abs(Math.sin(phase * Math.PI * 2));
    frames.push(renderFrame(depth, glow, -3 + phase * (width + 6)));
  }
  return frames;
};
/** The plain-text wordmark used for the `none`/`NO_COLOR` path, exported for callers and tests. */
export const plainWordmark = (): string => {
  return PLAIN;
};
