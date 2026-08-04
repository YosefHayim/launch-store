import { renderBuffer, type Cell, type ColorDepth, type Rgb } from './halfblock.js';
const EMIT_THRESHOLD = 18;
/** Linear-interpolate two colors at `t` (0->a, 1->b), rounded to 8-bit channels. */
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
};
/** Scale a color's brightness (used for fade-in / dimming), unclamped - {@link Pixmap.colorAt} clamps. */
const scale = (c: Rgb, k: number): Rgb => {
  return [c[0] * k, c[1] * k, c[2] * k];
};
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
    if (px < 0) return;
    if (py < 0) return;
    if (px >= this.w) return;
    if (py >= this.h) return;
    if (alpha <= 0) return;
    const channelOffset = (py * this.w + px) * 3;
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
  /** Write an opaque pixel (a crisp sprite/letter core), overwriting whatever bloom was under it. */
  set(x: number, y: number, color: Rgb): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0) return;
    if (py < 0) return;
    if (px >= this.w) return;
    if (py >= this.h) return;
    const channelOffset = (py * this.w + px) * 3;
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
/** Additively splat a soft radial disc of `color` - the universal glow/bloom primitive. */
const addDisc = (
  pm: Pixmap,
  cx: number,
  cy: number,
  color: Rgb,
  intensity: number,
  radius: number,
): void => {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      pm.add(cx + dx, cy + dy, color, intensity * (1 - d / radius) ** 2);
    }
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
const LOGO_H = 5;
const SHEAR = 0.3;
const GAP = 1;
const SPACE_W = 3;
/** The LAUNCH STORE letters as upright 4x5 bitmaps ('X' = lit). {@link SHEAR} leans them at render. */
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
const FILL_TOP: Rgb = [248, 249, 255];
const FILL_BOTTOM: Rgb = [198, 170, 255];
const HIGHLIGHT: Rgb = [255, 255, 255];
const GLOW: Rgb = [138, 96, 255];
/** A laid-out wordmark pixel: padded pixmap position, gradient color, and which letter it belongs to. */
type WordPixel = {
  x: number;
  y: number;
  color: Rgb;
  letter: number;
};
/** The laid-out wordmark: its pixels (tagged by letter), total width, and each letter's center x. */
type WordLayout = {
  pixels: WordPixel[];
  width: number;
  letterCx: Map<number, number>;
};
/**
 * Lay the word out once: every lit glyph pixel sheared into italic and normalized to x>=0, tagged with the
 * letter index it belongs to (so the rocket can ignite letters one at a time), plus each letter's center x.
 */
const layoutWord = (): WordLayout => {
  const lean: {
    x: number;
    y: number;
    k: number;
    letter: number;
  }[] = [];
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
    let xs = xsByLetter.get(p.letter);
    if (xs === undefined) xs = [];
    xs.push(p.x);
    xsByLetter.set(p.letter, xs);
  }
  const letterCx = new Map<number, number>();
  for (const [li, xs] of xsByLetter)
    letterCx.set(li, xs.reduce((sum, x) => sum + x, 0) / xs.length);
  return { pixels, width: maxX - minX + 1, letterCx };
};
const ROCKET_WIDTH = 15;
/** Build the rocket sprite. */
const buildRocket = (): readonly string[] => {
  const w = ROCKET_WIDTH;
  const h = 7;
  const cy = 3;
  const grid: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  const hullRadius = (x: number): number => {
    if (x === 2) return 1;
    if (x === 3) return 2;
    if (x >= 4 && x <= 10) return 3;
    return -1;
  };
  const noseRadius = (x: number): number => {
    if (x === 11) return 2;
    if (x === 12) return 2;
    if (x === 13) return 1;
    if (x === 14) return 0;
    return -1;
  };
  const put = (y: number, x: number, ch: string): void => {
    const characterRow = grid[y];
    if (characterRow) characterRow[x] = ch;
  };
  for (let x = 2; x <= 10; x++) {
    const r = hullRadius(x);
    for (let dy = -r; dy <= r; dy++) {
      let hullMaterial = 'B';
      if (dy > 0) hullMaterial = 'b';
      put(cy + dy, x, hullMaterial);
    }
  }
  for (let x = 11; x <= 14; x++) {
    const r = noseRadius(x);
    for (let dy = -r; dy <= r; dy++) put(cy + dy, x, 'N');
  }
  for (let dy = -3; dy <= 3; dy++) {
    const characterRow = grid[cy + dy];
    if (characterRow && characterRow[9] !== '.') characterRow[9] = 'R';
  }
  for (let dy = -1; dy <= 1; dy++) {
    put(cy + dy, 6, 'W');
    put(cy + dy, 7, 'W');
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
  return grid.map((characterRow) => characterRow.join(''));
};
const ROCKET = buildRocket();
const ROCKET_PALETTE: Record<string, Rgb> = {
  B: [232, 235, 244],
  b: [150, 156, 175],
  N: [206, 178, 255],
  W: [120, 225, 255],
  R: [255, 92, 80],
  F: [150, 110, 255],
};
/** Apple badge sprite. */
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
  A: [244, 247, 255],
  L: [120, 220, 130],
};
/** Build the Google Play badge sprite. */
const buildGPlay = (): readonly string[] => {
  const w = 13;
  const h = 15;
  const mid = 7;
  const grid: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  for (let y = 0; y < h; y++) {
    const characterRow = grid[y];
    if (!characterRow) continue;
    const rightX = Math.round(w - 1 - Math.abs(y - mid) * ((w - 2) / mid));
    for (let x = 1; x <= rightX; x++) {
      const top = y <= mid;
      const left = x < w * 0.42;
      let badgeMaterial = 'o';
      if (top && left) badgeMaterial = 'c';
      if (top && !left) badgeMaterial = 'g';
      if (!top && left) badgeMaterial = 'r';
      characterRow[x] = badgeMaterial;
    }
    if (y === mid) {
      characterRow[rightX] = 'W';
      const prev = rightX - 1;
      if (prev >= 0) characterRow[prev] = 'W';
    }
  }
  return grid.map((characterRow) => characterRow.join(''));
};
const GPLAY = buildGPlay();
const GPLAY_PALETTE: Record<string, Rgb> = {
  c: [0, 186, 255],
  g: [0, 224, 120],
  W: [245, 255, 255],
  o: [255, 178, 38],
  r: [255, 61, 66],
};
/**
 * Stamp a sprite at (ox,oy): an optional soft glow halo under each lit pixel (skipped when `glowRadius`<=0,
 * for flat hard-edged logos), then opaque cores scaled by `intensity`.
 */
const stampSprite = (
  pm: Pixmap,
  grid: readonly string[],
  palette: Record<string, Rgb>,
  ox: number,
  oy: number,
  intensity: number,
  glowColor: Rgb,
  glowRadius: number,
): void => {
  if (glowRadius > 0) {
    for (let gy = 0; gy < grid.length; gy++) {
      const spriteRow = grid[gy];
      if (spriteRow === undefined) continue;
      for (let gx = 0; gx < spriteRow.length; gx++) {
        const mat = spriteRow.charAt(gx);
        if (mat === '.') continue;
        if (!palette[mat]) continue;
        addDisc(pm, ox + gx, oy + gy, glowColor, 0.5 * intensity, glowRadius);
      }
    }
  }
  for (let gy = 0; gy < grid.length; gy++) {
    const spriteRow = grid[gy];
    if (spriteRow === undefined) continue;
    for (let gx = 0; gx < spriteRow.length; gx++) {
      const core = palette[spriteRow.charAt(gx)];
      if (!core) continue;
      pm.set(ox + gx, oy + gy, scale(core, Math.min(1, intensity)));
    }
  }
};
const PAD_X = 7;
const ROCKET_TOP = 0;
const WM_TOP = 8;
const BADGE_TOP = 14;
const ROCKET_CY = ROCKET_TOP + 3;
const BADGE_GAP = 7;
const FLAME_HOT: Rgb = [255, 255, 235];
const FLAME_MID: Rgb = [255, 150, 40];
const FLY_FRAMES = 46;
const SETTLE_FRAMES = 12;
/** A letter or badge the rocket's nose lights as it sweeps past its x. */
type Trigger = {
  letter: number;
  x: number;
};
/** The fixed stage geometry, computed once: pixmap size, placements, and rocket-sweep triggers. */
type Stage = {
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
};
/** Build the fixed scene dimensions and placements. */
const buildStage = (): Stage => {
  const { pixels, width, letterCx } = layoutWord();
  const w = width + PAD_X * 2;
  const bottom = BADGE_TOP + APPLE.length;
  const h = bottom + (bottom % 2);
  const wmX = PAD_X;
  let appleW = 0;
  const firstAppleRow = APPLE[0];
  if (firstAppleRow !== undefined) appleW = firstAppleRow.length;
  let gplayW = 0;
  const firstGooglePlayRow = GPLAY[0];
  if (firstGooglePlayRow !== undefined) gplayW = firstGooglePlayRow.length;
  const badgeSpan = appleW + BADGE_GAP + gplayW;
  const appleX = Math.round((w - badgeSpan) / 2);
  const gplayX = appleX + appleW + BADGE_GAP;
  const letterTriggers: Trigger[] = [...letterCx].map(([letter, letterCenterX]) => ({
    letter,
    x: wmX + letterCenterX,
  }));
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
};
const STAGE: Stage = buildStage();
/** Deterministic starfield (fixed positions so stars twinkle in place instead of jumping each frame). */
type Star = {
  x: number;
  y: number;
  phase: number;
};
/** Build the fixed starfield used by every animation frame. */
const buildStars = (): readonly Star[] => {
  const stars: Star[] = [];
  let randomSeed = 1337;
  const nextRandomFraction = (): number => {
    randomSeed = (randomSeed * 1103515245 + 12345) & 0x7fffffff;
    return randomSeed / 0x7fffffff;
  };
  for (let i = 0; i < 26; i++) {
    stars.push({
      x: Math.floor(nextRandomFraction() * STAGE.w),
      y: Math.floor(nextRandomFraction() * (ROCKET_TOP + 7)),
      phase: nextRandomFraction() * Math.PI * 2,
    });
  }
  return stars;
};
const STARS = buildStars();
const clamp01 = (unboundedNumber: number): number => {
  if (unboundedNumber < 0) return 0;
  if (unboundedNumber > 1) return 1;
  return unboundedNumber;
};
const easeInOut = (progress: number): number => {
  if (progress < 0.5) return 2 * progress * progress;
  return 1 - (-2 * progress + 2) ** 2 / 2;
};
/** Twinkling stars across the sky band. */
const drawStars = (pm: Pixmap, frame: number): void => {
  for (const s of STARS) {
    const twinkle = 0.25 + 0.75 * Math.abs(Math.sin(frame * 0.3 + s.phase));
    pm.add(s.x, s.y, [210, 200, 255], 0.5 * twinkle);
  }
};
/** The rocket's exhaust: a fading comet trail to the left plus a flickering flame tongue right behind it. */
const drawExhaust = (pm: Pixmap, noseX: number, frame: number): void => {
  const tailX = noseX - ROCKET_WIDTH;
  const start = Math.max(-4, tailX - 13);
  let trailLength = tailX - start;
  if (trailLength === 0) trailLength = 1;
  for (let x = Math.floor(start); x < tailX; x++) {
    const t = (x - start) / trailLength;
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
};
/**
 * Paint the wordmark for this frame. Each letter's brightness ramps as the rocket's nose sweeps past its
 * center; during the settle the whole mark breathes and a white shimmer sweeps across.
 */
const drawWordmark = (pm: Pixmap, noseX: number, breathe: number, sweepX: number | null): void => {
  const bright = new Map<number, number>();
  for (const t of STAGE.letterTriggers) bright.set(t.letter, clamp01((noseX - t.x + 3) / 6));
  for (const p of STAGE.pixels) {
    let b = bright.get(p.letter);
    if (b === undefined) b = 0;
    if (b <= 0.01) continue;
    addDisc(pm, STAGE.wmX + p.x, WM_TOP + p.y, GLOW, b * breathe * 0.9, 1);
  }
  for (const p of STAGE.pixels) {
    let b = bright.get(p.letter);
    if (b === undefined) b = 0;
    if (b <= 0.01) continue;
    let color = scale(p.color, b);
    if (sweepX !== null) {
      const distance = Math.abs(STAGE.wmX + p.x - sweepX);
      if (distance < 1.5) color = lerp(color, HIGHLIGHT, (1 - distance / 1.5) * b);
    }
    pm.set(STAGE.wmX + p.x, WM_TOP + p.y, color);
  }
};
/** Store badge brightness: dim until the rocket passes its column, a flash as it crosses, then full charge. */
const badgeIntensity = (noseX: number, cx: number): number => {
  let base = 0.65;
  if (noseX > cx) base = 1;
  const flash = Math.exp(-(((noseX - cx) / 4) ** 2)) * 0.7;
  return Math.min(1.25, base + flash);
};
/** Parameters that fully determine one composited frame of the scene. */
type SceneState = {
  noseX: number;
  breathe: number;
  sweepX: number | null;
  showRocket: boolean;
  frame: number;
};
/** Composite one frame: stars, wordmark, badges, and (while flying) the rocket + exhaust. */
const composeScene = (depth: ColorDepth, s: SceneState): string => {
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
      s.noseX - ROCKET_WIDTH,
      ROCKET_TOP + jitter,
      1,
      [170, 195, 255],
      1,
    );
  }
  return renderBuffer(fold(pm), depth);
};
/** The settled lockup: rocket gone, every letter lit at full glow, badges charged, no shimmer. */
const settledState = (): SceneState => {
  return {
    noseX: STAGE.w + 30,
    breathe: 1,
    sweepX: null,
    showRocket: false,
    frame: FLY_FRAMES + SETTLE_FRAMES,
  };
};
/** Plain-text fallback shown for `NO_COLOR`/piped output and CI (the scene needs color to render). */
const PLAIN = '> Launch Store - Ship to the App Store + Google Play';
/**
 * The settled banner as a single frame - for static/piped output, logs, or a still header. `none` returns
 * the plain tagline (the bloom and color logos can't render without color).
 */
export const renderRocketBanner = (depth: ColorDepth): string => {
  if (depth === 'none') return PLAIN;
  return composeScene(depth, settledState());
};
/**
 * The animation frames: the rocket flies in lighting the wordmark and charging the badges, then the lockup
 * breathes with a shimmer sweep and rests on the settled still. Every frame is the same size, so a caller
 * can redraw in place. `none` yields a single plain-text frame since the effect needs color.
 */
export const buildRocketFrames = (depth: ColorDepth): string[] => {
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
};
/** The plain-text banner used for the `none`/`NO_COLOR` path, exported for callers and tests. */
export const plainRocketBanner = (): string => {
  return PLAIN;
};
