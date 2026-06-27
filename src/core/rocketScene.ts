/**
 * The `launch` banner artwork — a cinematic pixel-art scene: a rocket delivering the app to both stores.
 *
 * A silver rocket streaks left→right across a starfield; its nose ignites each letter of LAUNCH STORE in
 * its wake (purple bloom, one letter at a time) and charges the Apple and Google Play badges as it passes,
 * then it exits and the full lockup holds with a breathing glow and a shimmer sweep. Everything is
 * hand-pixeled and composited into one additive RGB {@link Pixmap}, folded to half-block `▀`/`▄`/`█` cells,
 * and handed to the shared {@link import("./halfblock.js")} encoder (truecolor / 256-color / plain).
 *
 * This module is pure (depth in, string[] out) so it's unit-testable without a terminal;
 * {@link import("./banner.js")} owns the animate-vs-static I/O. The store logos are deliberately stylized
 * (a white apple-with-leaf, a four-color play triangle) — recognizable, not the trademarked glyphs.
 */

import { renderBuffer, type Cell, type ColorDepth, type Rgb } from './halfblock.js';

const EMIT_THRESHOLD = 18; // summed-RGB below this reads as empty space — higher = crisper, less bloom haze

/** Linear-interpolate two colors at `t` (0→a, 1→b), rounded to 8-bit channels. */
function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Scale a color's brightness (used for fade-in / dimming), unclamped — {@link Pixmap.colorAt} clamps. */
function scale(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * A small additive RGB canvas. Glow is summed in (overlapping halos brighten), solid cores are written
 * opaque on top, and {@link colorAt} clamps to 8-bit and treats near-black as empty so the stage stays dark.
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

  /** Add light (bloom/flame/stars): accumulate `color * alpha` into a pixel. */
  add(x: number, y: number, color: Rgb, alpha: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h || alpha <= 0) return;
    const o = (py * this.w + px) * 3;
    this.buf[o] = (this.buf[o] ?? 0) + color[0] * alpha;
    this.buf[o + 1] = (this.buf[o + 1] ?? 0) + color[1] * alpha;
    this.buf[o + 2] = (this.buf[o + 2] ?? 0) + color[2] * alpha;
  }

  /** Write an opaque pixel (a crisp sprite/letter core), overwriting whatever bloom was under it. */
  set(x: number, y: number, color: Rgb): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
    const o = (py * this.w + px) * 3;
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

/** Additively splat a soft radial disc of `color` — the universal glow/bloom primitive. */
function addDisc(
  pm: Pixmap,
  cx: number,
  cy: number,
  color: Rgb,
  intensity: number,
  radius: number,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      pm.add(cx + dx, cy + dy, color, intensity * (1 - d / radius) ** 2);
    }
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
      if (top && bottom) row.push({ ch: '▀', fg: top, bg: bottom });
      else if (top) row.push({ ch: '▀', fg: top });
      else if (bottom) row.push({ ch: '▄', fg: bottom });
      else row.push({ ch: ' ' });
    }
    rows.push(row);
  }
  return rows;
}

/* ─────────────────────────── the LAUNCH STORE wordmark (compact mini-font) ─────────────────────────── */

const LOGO_H = 5;
const SHEAR = 0.3; // italic lean
const GAP = 1; // blank px between letters
const SPACE_W = 3; // blank px for the word space

/** The LAUNCH STORE letters as upright 4×5 bitmaps ('X' = lit). {@link SHEAR} leans them italic at render. */
const GLYPHS: Record<string, readonly string[]> = {
  L: ['X...', 'X...', 'X...', 'X...', 'XXXX'],
  A: ['.XX.', 'X..X', 'XXXX', 'X..X', 'X..X'],
  U: ['X..X', 'X..X', 'X..X', 'X..X', '.XX.'],
  N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'],
  C: ['.XXX', 'X...', 'X...', 'X...', '.XXX'],
  H: ['X..X', 'X..X', 'XXXX', 'X..X', 'X..X'],
  S: ['.XXX', 'X...', '.XX.', '...X', 'XXX.'],
  T: ['XXXX', '.X..', '.X..', '.X..', '.X..'],
  O: ['.XX.', 'X..X', 'X..X', 'X..X', '.XX.'],
  R: ['XXX.', 'X..X', 'XXX.', 'X.X.', 'X..X'],
  E: ['XXXX', 'X...', 'XXX.', 'X...', 'XXXX'],
};

const WORD = 'LAUNCH STORE';
const FILL_TOP: Rgb = [248, 249, 255]; // letter gradient top (near-white)
const FILL_BOTTOM: Rgb = [198, 170, 255]; // letter gradient bottom (lavender)
const HIGHLIGHT: Rgb = [255, 255, 255]; // shimmer sweep color
const GLOW: Rgb = [138, 96, 255]; // purple bloom around the letters

/** A laid-out wordmark pixel: padded pixmap position, gradient color, and which letter it belongs to. */
interface WordPixel {
  x: number;
  y: number;
  color: Rgb;
  letter: number;
}

/** The laid-out wordmark: its pixels (tagged by letter), total width, and each letter's center x. */
interface WordLayout {
  pixels: WordPixel[];
  width: number;
  letterCx: Map<number, number>;
}

/**
 * Lay the word out once: every lit glyph pixel sheared into italic and normalized to x≥0, tagged with the
 * letter index it belongs to (so the rocket can ignite letters one at a time), plus each letter's center x.
 */
function layoutWord(): WordLayout {
  const lean: { x: number; y: number; k: number; letter: number }[] = [];
  let cursor = 0;
  let letter = -1;
  for (const ch of WORD) {
    if (ch === ' ') {
      cursor += SPACE_W;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    letter++;
    const glyphWidth = glyph[0]?.length ?? 0;
    for (let gy = 0; gy < LOGO_H; gy++) {
      const glyphRow = glyph[gy] ?? '';
      for (let gx = 0; gx < glyphWidth; gx++) {
        if (glyphRow.charAt(gx) !== 'X') continue;
        lean.push({
          x: Math.round(cursor + gx + (LOGO_H - 1 - gy) * SHEAR),
          y: gy,
          k: gy / (LOGO_H - 1),
          letter,
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
  if (!Number.isFinite(minX)) return { pixels: [], width: 0, letterCx: new Map() };

  const pixels = lean.map((p) => ({
    x: p.x - minX,
    y: p.y,
    color: lerp(FILL_TOP, FILL_BOTTOM, p.k),
    letter: p.letter,
  }));

  const xsByLetter = new Map<number, number[]>();
  for (const p of pixels) {
    const xs = xsByLetter.get(p.letter) ?? [];
    xs.push(p.x);
    xsByLetter.set(p.letter, xs);
  }
  const letterCx = new Map<number, number>();
  for (const [li, xs] of xsByLetter)
    letterCx.set(li, xs.reduce((sum, x) => sum + x, 0) / xs.length);

  return { pixels, width: maxX - minX + 1, letterCx };
}

/* ─────────────────────────── sprites: rocket, Apple badge, Google Play badge ─────────────────────────── */

/**
 * Build a crisp rocket pointing right from exact geometry (so every pixel is deliberate): a rounded silver
 * hull, a tapered lavender nose cone, a red trim ring, a cyan porthole, and swept fins. The flame is drawn
 * separately so it can flicker. `cy` (=3) is the hull centerline; the flame attaches at the back on that row.
 */
function buildRocket(): readonly string[] {
  const w = 15;
  const h = 7;
  const cy = 3;
  const grid: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  const hullRadius = (x: number): number =>
    x === 2 ? 1 : x === 3 ? 2 : x >= 4 && x <= 10 ? 3 : -1;
  const noseRadius = (x: number): number =>
    x === 11 ? 2 : x === 12 ? 2 : x === 13 ? 1 : x === 14 ? 0 : -1;

  const put = (y: number, x: number, ch: string): void => {
    const row = grid[y];
    if (row) row[x] = ch;
  };

  for (let x = 2; x <= 10; x++) {
    const r = hullRadius(x);
    for (let dy = -r; dy <= r; dy++) put(cy + dy, x, dy > 0 ? 'b' : 'B');
  }
  for (let x = 11; x <= 14; x++) {
    const r = noseRadius(x);
    for (let dy = -r; dy <= r; dy++) put(cy + dy, x, 'N');
  }
  for (let dy = -3; dy <= 3; dy++) {
    const row = grid[cy + dy];
    if (row && row[9] !== '.') row[9] = 'R'; // trim ring near the nose
  }
  for (let dy = -1; dy <= 1; dy++) {
    put(cy + dy, 6, 'W');
    put(cy + dy, 7, 'W'); // porthole
  }
  const fins: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [6, 0],
    [6, 1],
    [6, 2],
    [5, 0],
    [5, 1],
  ];
  for (const [y, x] of fins) put(y, x, 'F');

  return grid.map((row) => row.join(''));
}

const ROCKET = buildRocket();
const ROCKET_PALETTE: Record<string, Rgb> = {
  B: [232, 235, 244], // hull (light silver)
  b: [150, 156, 175], // hull underside shadow
  N: [206, 178, 255], // nose cone (lavender)
  W: [120, 225, 255], // porthole (cyan)
  R: [255, 92, 80], // trim ring (classic rocket red)
  F: [150, 110, 255], // fins (purple)
};

/**
 * Apple silhouette, hand-drawn at 14×15 so the iconic features are unambiguous: an angled leaf, a two-hump
 * top, a concave bite scooped from the right edge (shoulder above, bulge below), and split feet.
 */
const APPLE: readonly string[] = [
  '.........LL...',
  '........LL....',
  '.......L......',
  '...AA....AA...',
  '..AAAA..AAAA..',
  '.AAAAAAAAAAAA.',
  'AAAAAAAAAAAAAA',
  'AAAAAAAAAAAA..',
  'AAAAAAAAAA....',
  'AAAAAAAAAA....',
  'AAAAAAAAAAAA..',
  'AAAAAAAAAAAAAA',
  '.AAAAAAAAAAAA.',
  '..AAAAAAAAAA..',
  '...AA....AA...',
];
const APPLE_PALETTE: Record<string, Rgb> = {
  A: [244, 247, 255], // white apple body
  L: [120, 220, 130], // green leaf
};

/**
 * Google Play triangle pointing right, built from exact geometry: a vertical left edge tapering to a
 * single-pixel apex, split into the four brand colors (cyan/green on top, red/amber below) with a bright tip.
 */
function buildGPlay(): readonly string[] {
  const w = 13;
  const h = 15;
  const mid = 7;
  const grid: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    if (!row) continue;
    const rightX = Math.round(w - 1 - Math.abs(y - mid) * ((w - 2) / mid));
    for (let x = 1; x <= rightX; x++) {
      const top = y <= mid;
      const left = x < w * 0.42;
      row[x] = top ? (left ? 'c' : 'g') : left ? 'r' : 'o';
    }
    if (y === mid) {
      row[rightX] = 'W'; // bright apex tip
      const prev = rightX - 1;
      if (prev >= 0) row[prev] = 'W';
    }
  }
  return grid.map((row) => row.join(''));
}

const GPLAY = buildGPlay();
const GPLAY_PALETTE: Record<string, Rgb> = {
  c: [0, 186, 255], // cyan (top-left)
  g: [0, 224, 120], // green (top-right)
  W: [245, 255, 255], // apex highlight
  o: [255, 178, 38], // amber (bottom-right)
  r: [255, 61, 66], // red (bottom-left)
};

/**
 * Stamp a sprite at (ox,oy): an optional soft glow halo under each lit pixel (skipped when `glowRadius`≤0,
 * for flat hard-edged logos), then opaque cores scaled by `intensity`.
 */
function stampSprite(
  pm: Pixmap,
  grid: readonly string[],
  palette: Record<string, Rgb>,
  ox: number,
  oy: number,
  intensity: number,
  glowColor: Rgb,
  glowRadius: number,
): void {
  if (glowRadius > 0) {
    for (let gy = 0; gy < grid.length; gy++) {
      const row = grid[gy] ?? '';
      for (let gx = 0; gx < row.length; gx++) {
        const mat = row.charAt(gx);
        if (mat === '.' || !palette[mat]) continue;
        addDisc(pm, ox + gx, oy + gy, glowColor, 0.5 * intensity, glowRadius);
      }
    }
  }
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy] ?? '';
    for (let gx = 0; gx < row.length; gx++) {
      const core = palette[row.charAt(gx)];
      if (!core) continue;
      pm.set(ox + gx, oy + gy, scale(core, Math.min(1, intensity)));
    }
  }
}

/* ─────────────────────────── stage layout + timeline ─────────────────────────── */

const PAD_X = 7;
const ROCKET_TOP = 0; // rocket occupies the top band (y 0..6); its center row is ROCKET_TOP+3
const WM_TOP = 8; // wordmark band (y 8..12)
const BADGE_TOP = 14; // store badges band
const ROCKET_W = ROCKET[0]?.length ?? 0;
const ROCKET_CY = ROCKET_TOP + 3;
const BADGE_GAP = 7; // breathing room between the two badges

const FLAME_HOT: Rgb = [255, 255, 235];
const FLAME_MID: Rgb = [255, 150, 40];

const FLY_FRAMES = 46; // rocket crossing the stage
const SETTLE_FRAMES = 12; // the lockup breathing + shimmer once the rocket has gone

/** A letter or badge the rocket's nose lights as it sweeps past its x. */
interface Trigger {
  letter: number;
  x: number;
}

/** The fixed stage geometry, computed once: pixmap size, placements, and rocket-sweep triggers. */
interface Stage {
  pixels: readonly WordPixel[];
  width: number;
  w: number;
  h: number;
  wmX: number;
  appleX: number;
  gplayX: number;
  appleCx: number;
  gplayCx: number;
  letterTriggers: readonly Trigger[];
}

const STAGE: Stage = (() => {
  const { pixels, width, letterCx } = layoutWord();
  const w = width + PAD_X * 2;
  const bottom = BADGE_TOP + APPLE.length; // through the bottom of the badges
  const h = bottom + (bottom % 2); // round up to an even pixel height so half-block folding pairs cleanly
  const wmX = PAD_X;
  const appleW = APPLE[0]?.length ?? 0;
  const gplayW = GPLAY[0]?.length ?? 0;
  const badgeSpan = appleW + BADGE_GAP + gplayW;
  const appleX = Math.round((w - badgeSpan) / 2);
  const gplayX = appleX + appleW + BADGE_GAP;
  const letterTriggers: Trigger[] = [...letterCx].map(([letter, cx]) => ({ letter, x: wmX + cx }));
  return {
    pixels,
    width,
    w,
    h,
    wmX,
    appleX,
    gplayX,
    appleCx: appleX + appleW / 2,
    gplayCx: gplayX + gplayW / 2,
    letterTriggers,
  };
})();

/** Deterministic starfield (fixed positions so stars twinkle in place instead of jumping each frame). */
const STARS: readonly { x: number; y: number; phase: number }[] = (() => {
  const stars: { x: number; y: number; phase: number }[] = [];
  let seed = 1337;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 26; i++) {
    stars.push({
      x: Math.floor(rand() * STAGE.w),
      y: Math.floor(rand() * (ROCKET_TOP + 7)),
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
})();

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** Twinkling stars across the sky band. */
function drawStars(pm: Pixmap, frame: number): void {
  for (const s of STARS) {
    const twinkle = 0.25 + 0.75 * Math.abs(Math.sin(frame * 0.3 + s.phase));
    pm.add(s.x, s.y, [210, 200, 255], 0.5 * twinkle);
  }
}

/** The rocket's exhaust: a fading comet trail to the left plus a flickering flame tongue right behind it. */
function drawExhaust(pm: Pixmap, noseX: number, frame: number): void {
  const tailX = noseX - ROCKET_W; // back of the rocket (flame origin)
  const start = Math.max(-4, tailX - 13); // short trail so the rocket body stays crisp, not a comet smear
  for (let x = Math.floor(start); x < tailX; x++) {
    const t = (x - start) / (tailX - start || 1); // 0 far → 1 near the rocket
    const warm = lerp(GLOW, FLAME_MID, t);
    const a = 0.4 * t * t;
    pm.add(x, ROCKET_CY, lerp(warm, FLAME_HOT, t), a * 1.3);
    pm.add(x, ROCKET_CY - 1, warm, a * 0.4);
    pm.add(x, ROCKET_CY + 1, warm, a * 0.4);
  }
  const len = 4 + Math.round(1.5 * Math.sin(frame * 0.9));
  for (let f = 0; f < len; f++) {
    const x = tailX - 1 - f;
    const t = 1 - f / len;
    const c = lerp(FLAME_MID, FLAME_HOT, t);
    pm.add(x, ROCKET_CY, c, 1.1 * t);
    pm.add(x, ROCKET_CY - 1, c, 0.55 * t);
    pm.add(x, ROCKET_CY + 1, c, 0.55 * t);
  }
}

/**
 * Paint the wordmark for this frame. Each letter's brightness ramps as the rocket's nose sweeps past its
 * center; during the settle the whole mark breathes and a white shimmer sweeps across.
 */
function drawWordmark(pm: Pixmap, noseX: number, breathe: number, sweepX: number | null): void {
  const bright = new Map<number, number>();
  for (const t of STAGE.letterTriggers) bright.set(t.letter, clamp01((noseX - t.x + 3) / 6));

  for (const p of STAGE.pixels) {
    const b = bright.get(p.letter) ?? 0;
    if (b <= 0.01) continue;
    addDisc(pm, STAGE.wmX + p.x, WM_TOP + p.y, GLOW, b * breathe * 0.9, 1);
  }
  for (const p of STAGE.pixels) {
    const b = bright.get(p.letter) ?? 0;
    if (b <= 0.01) continue;
    let color = scale(p.color, b);
    if (sweepX !== null) {
      const distance = Math.abs(STAGE.wmX + p.x - sweepX);
      if (distance < 1.5) color = lerp(color, HIGHLIGHT, (1 - distance / 1.5) * b);
    }
    pm.set(STAGE.wmX + p.x, WM_TOP + p.y, color);
  }
}

/** Store badge brightness: dim until the rocket passes its column, a flash as it crosses, then full charge. */
function badgeIntensity(noseX: number, cx: number): number {
  const base = noseX > cx ? 1 : 0.65;
  const flash = Math.exp(-(((noseX - cx) / 4) ** 2)) * 0.7;
  return Math.min(1.25, base + flash);
}

/** Parameters that fully determine one composited frame of the scene. */
interface SceneState {
  noseX: number;
  breathe: number;
  sweepX: number | null;
  showRocket: boolean;
  frame: number;
}

/** Composite one frame: stars, wordmark, badges, and (while flying) the rocket + exhaust. */
function composeScene(depth: ColorDepth, s: SceneState): string {
  const pm = new Pixmap(STAGE.w, STAGE.h);
  drawStars(pm, s.frame);
  drawWordmark(pm, s.noseX, s.breathe, s.sweepX);

  // badges render flat (glowRadius 0) so the logos stay hard-edged and precise, not haloed
  stampSprite(
    pm,
    APPLE,
    APPLE_PALETTE,
    STAGE.appleX,
    BADGE_TOP,
    badgeIntensity(s.noseX, STAGE.appleCx),
    [0, 0, 0],
    0,
  );
  stampSprite(
    pm,
    GPLAY,
    GPLAY_PALETTE,
    STAGE.gplayX,
    BADGE_TOP,
    badgeIntensity(s.noseX, STAGE.gplayCx),
    [0, 0, 0],
    0,
  );

  if (s.showRocket) {
    drawExhaust(pm, s.noseX, s.frame);
    const jitter = Math.round(Math.sin(s.frame * 1.7)); // tiny liftoff shake
    stampSprite(
      pm,
      ROCKET,
      ROCKET_PALETTE,
      s.noseX - ROCKET_W,
      ROCKET_TOP + jitter,
      1,
      [170, 195, 255],
      1,
    );
  }

  return renderBuffer(fold(pm), depth);
}

/** The settled lockup: rocket gone, every letter lit at full glow, badges charged, no shimmer. */
function settledState(): SceneState {
  return {
    noseX: STAGE.w + 30,
    breathe: 1,
    sweepX: null,
    showRocket: false,
    frame: FLY_FRAMES + SETTLE_FRAMES,
  };
}

/** Plain-text fallback shown for `NO_COLOR`/piped output and CI (the scene needs color to render). */
const PLAIN = '▸ Launch Store — Ship to the App Store + Google Play';

/**
 * The settled banner as a single frame — for static/piped output, logs, or a still header. `none` returns
 * the plain tagline (the bloom and color logos can't render without color).
 */
export function renderRocketBanner(depth: ColorDepth): string {
  return depth === 'none' ? PLAIN : composeScene(depth, settledState());
}

/**
 * The animation frames: the rocket flies in lighting the wordmark and charging the badges, then the lockup
 * breathes with a shimmer sweep and rests on the settled still. Every frame is the same size, so a caller
 * can redraw in place. `none` yields a single plain-text frame since the effect needs color.
 */
export function buildRocketFrames(depth: ColorDepth): string[] {
  if (depth === 'none') return [PLAIN];
  const frames: string[] = [];
  for (let i = 0; i < FLY_FRAMES; i++) {
    const noseX = -6 + easeInOut(i / FLY_FRAMES) * (STAGE.w + 20);
    frames.push(
      composeScene(depth, { noseX, breathe: 1, sweepX: null, showRocket: true, frame: i }),
    );
  }
  for (let hRow = 0; hRow < SETTLE_FRAMES; hRow++) {
    const breathe = 0.62 + 0.38 * Math.abs(Math.sin(hRow * 0.5));
    const sweepX = STAGE.wmX - 4 + ((hRow * 5) % (STAGE.width + 8));
    frames.push(
      composeScene(depth, {
        noseX: STAGE.w + 30,
        breathe,
        sweepX,
        showRocket: false,
        frame: FLY_FRAMES + hRow,
      }),
    );
  }
  frames.push(renderRocketBanner(depth)); // rest on a clean settled lockup
  return frames;
}

/** The plain-text banner used for the `none`/`NO_COLOR` path, exported for callers and tests. */
export function plainRocketBanner(): string {
  return PLAIN;
}
