/**
 * The `launch` ASCII banner — a cinematic rocket lift-off that delivers to the App Store and Google
 * Play, shown on the no-args front door (just before the interactive wizard).
 *
 * It's drawn as **half-block pixel art**, not text art. Every frame is composed on a fixed-size cell
 * buffer (a HEIGHT×WIDTH grid of {@link Cell}s); each cell can carry a foreground *and* a background
 * color and a half-block glyph (`▀`/`▄`/`█`), so a single character encodes two stacked pixels — the
 * top half painted in the foreground color, the bottom half in the background. That doubles the
 * vertical resolution and smooths the diagonals, which is how terminal image renderers (chafa, viu,
 * timg) draw crisp logos. Sprites are authored as RGB pixel bitmaps ({@link PLAY_PX}, {@link APPLE_PX},
 * {@link ROCKET_PX}) and their pixel-row pairs are folded into half-block cells at stamp time.
 *
 * Color is truecolor (24-bit) where the terminal advertises it (`COLORTERM`), so brand hexes land
 * exactly; otherwise each RGB is downsampled to the nearest 256-color code. It degrades safely: only a
 * real interactive TTY (and not CI) animates; everywhere else — piped output, log files, CI — prints a
 * single static frame so transcripts stay clean. `NO_COLOR` keeps the animation but drops all color.
 * The frame-builder and mode/depth selection are pure so they're unit-testable; {@link renderBanner}
 * takes an injectable stream + sleep so the animation can be tested without real timers.
 */

/** Banner canvas size. Every frame is exactly this many rows/cols so each redraw overwrites cleanly. */
const WIDTH = 64;
const HEIGHT = 17;

/** An sRGB color as a `[r, g, b]` triple (0–255). Emitted as truecolor, or downsampled to 256-color. */
type Rgb = readonly [number, number, number];

/**
 * The banner palette as RGB. Brand colors are the real hexes (Google's #4285F4/#34A853/#FBBC04/#EA4335
 * play facets, silver Apple/rocket, cyan window) so they're exact under truecolor and close under the
 * 256-color fallback. Honored only when color is enabled; the static/piped and `NO_COLOR` paths render
 * every cell as plain text.
 */
const P = {
  rocket: [214, 216, 222],
  nose: [232, 72, 58],
  window: [88, 198, 255],
  fin: [232, 72, 58],
  nozzle: [120, 122, 130],
  flameCore: [255, 214, 92],
  flameMid: [255, 146, 36],
  flameTip: [255, 92, 20],
  apple: [228, 230, 236],
  leaf: [150, 200, 120],
  playBlue: [66, 133, 244],
  playGreen: [52, 168, 83],
  playYellow: [251, 188, 4],
  playRed: [234, 67, 53],
  dim: [92, 94, 102],
  caption: [168, 170, 178],
  check: [70, 190, 110],
  word: [88, 184, 250],
  wordDim: [120, 122, 130],
  wordAccent: [150, 200, 245],
  tag: [140, 142, 150],
} as const satisfies Record<string, Rgb>;

/** Where the rocket sits horizontally — centered between the two store logos. */
const ROCKET_LEFT = 29;
/** Top-left of each store logo, and the rows reserved for captions / wordmark / taglines / status. */
const APPLE_TOP = 1;
const APPLE_LEFT = 3;
const PLAY_TOP = 1;
const PLAY_LEFT = 49;
const CAPTION_ROW = 8;
const WORD_ROW = 10;
const TAG_ROW = 12;
const STATUS_ROW = 16;
/** The rocket's top row travels from here (low on the pad) up to the apex during the climb. */
const START_TOP = 8;
const APEX_TOP = 0;

/**
 * The rocket as an RGB pixel bitmap: one string per pixel row, each char a color key — `n`ose cone,
 * `w` silver body, window `o`, `f`in, nozzle `d`. Spaces are transparent. 12 pixel rows fold into 6
 * half-block character rows; see {@link ROCKET_KEY} for the key→color map.
 */
const ROCKET_PX = [
  "   n   ",
  "  nnn  ",
  "  nnn  ",
  " wwwww ",
  " wooow ",
  " wooow ",
  " wwwww ",
  " wwwww ",
  "ffwwwff",
  "fwwwwwf",
  " wwwww ",
  "  ddd  ",
] as const;
/** Two exhaust flames alternated frame-to-frame for a flicker — `y` core, `o` mid, `t` cooler tip. */
const FLAME_A = ["  yyy  ", " oytyo ", "  oto  ", "   t   "] as const;
const FLAME_B = ["  yyy  ", " oototo", "   o   ", "   t   "] as const;
/** A short sparkle that replaces the rocket for one frame on impact ("burst"). */
const BURST = ["  *  ", " *✦* ", "  *  "] as const;

/**
 * The Apple logo as a pixel bitmap (`a` silver body, `l` green leaf). The silhouette is built to read
 * as the real mark: two top lobes with a center dip, a tapered leaf angled up-right from that dip, a
 * concave bite on the right edge, and two splayed feet with a center cleft. 12 pixel rows fold into 6
 * half-block rows. Dim grey while waiting, full color on strike.
 */
const APPLE_PX = [
  "        ll    ",
  "       ll     ",
  "   aa  l  aa  ",
  "  aaaa  aaaa  ",
  "  aaaaaaaaaaa ",
  " aaaaaaaaaa   ",
  " aaaaaaaaa    ",
  " aaaaaaaaa    ",
  " aaaaaaaaaaa  ",
  "  aaaaaaaaa   ",
  "  aaaa aaaa   ",
  "  aaa   aaa   ",
] as const;
/**
 * Build the Google Play logo as a four-facet pixel bitmap from geometry, so the triangle's edges are
 * exact rather than hand-stepped. The mark is a right-pointing triangle (top-left and bottom-left
 * corners, a centered right apex); its four facets meet at the centroid — `b`lue upper-left and `r`ed
 * lower-left hug the vertical left edge, `g`reen spans the top and `y`ellow the bottom, the two meeting
 * at the apex. `w`/`h` are pixels; an even `h` folds into `h / 2` half-block rows. Spaces are transparent.
 */
function buildPlayBitmap(w: number, h: number): string[] {
  const centerX = w / 3; // the triangle's centroid sits a third in from the vertical left edge
  const centerY = h / 2;
  const edgeSlope = centerY / w; // both edges rise from the left corners to the centered right apex
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    let row = "";
    for (let x = 0; x <= w; x++) {
      const px = x + 0.5;
      const inside = py >= edgeSlope * px && py <= h - edgeSlope * px;
      if (!inside) row += " ";
      else if (py < centerY) row += px < centerX * (py / centerY) ? "b" : "g";
      else row += px < centerX * ((h - py) / (h - centerY)) ? "r" : "y";
    }
    rows.push(row.replace(/ +$/, ""));
  }
  return rows;
}
const PLAY_PX = buildPlayBitmap(11, 12);

/** Key→color maps for the pixel bitmaps above. A key absent here (or a space) renders nothing. */
const ROCKET_KEY: Record<string, Rgb> = { n: P.nose, w: P.rocket, o: P.window, f: P.fin, d: P.nozzle };
const FLAME_KEY: Record<string, Rgb> = { y: P.flameCore, o: P.flameMid, t: P.flameTip };
const APPLE_KEY: Record<string, Rgb> = { a: P.apple, l: P.leaf };
const PLAY_KEY: Record<string, Rgb> = { b: P.playBlue, g: P.playGreen, r: P.playRed, y: P.playYellow };

const WORDMARK = "L  A  U  N  C  H";
const TAGLINE_1 = "ship iOS + Android from your own machine";
const TAGLINE_2 = "— your keys, your hardware, no Expo bill —";

/**
 * One terminal cell: a single glyph plus optional foreground/background colors. For half-block pixel
 * art the glyph is `▀`/`▄`/`█` with `fg` = the top pixel and `bg` = the bottom pixel; for text it's the
 * character with `fg` only. Both colors `undefined` renders the glyph with no ANSI escape.
 */
interface Cell {
  ch: string;
  fg?: Rgb;
  bg?: Rgb;
}

/** The full canvas: a fixed HEIGHT×WIDTH grid of cells, rebuilt fresh for every frame. */
type Buffer = Cell[][];

/** How much color to emit. `truecolor` for exact brand hex, `ansi256` for the downsampled fallback. */
export type ColorDepth = "none" | "ansi256" | "truecolor";

/** Value-equality for optional colors, so same-color cell runs coalesce into one ANSI span. */
function sameColor(a?: Rgb, b?: Rgb): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Whether a bitmap key cell is opaque (a real color key, not padding). */
function isOpaque(key: string): boolean {
  return key !== "" && key !== " ";
}

/** Downsample an RGB to the nearest xterm-256 code: greys to the grayscale ramp, else the 6×6×6 cube. */
function to256([r, g, b]: Rgb): number {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const channel = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * channel(r) + 6 * channel(g) + channel(b);
}

/** Build one SGR color parameter for the 38 (foreground) or 48 (background) channel at a given depth. */
function colorParam(channel: 38 | 48, rgb: Rgb, depth: ColorDepth): string {
  return depth === "truecolor" ? `${channel};2;${rgb[0]};${rgb[1]};${rgb[2]}` : `${channel};5;${to256(rgb)}`;
}

/** Wrap text in an SGR sequence for the given fg/bg. Built with `\x1b` (no raw byte) to stay greppable. */
function paint(text: string, fg: Rgb | undefined, bg: Rgb | undefined, depth: ColorDepth): string {
  if (depth === "none" || (!fg && !bg)) return text;
  const params: string[] = [];
  if (fg) params.push(colorParam(38, fg, depth));
  if (bg) params.push(colorParam(48, bg, depth));
  return `\x1b[${params.join(";")}m${text}\x1b[0m`;
}

/** A blank canvas of transparent spaces. */
function blank(): Buffer {
  return Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, (): Cell => ({ ch: " " })));
}

/**
 * Fold a pixel bitmap onto the buffer at `(top, left)` as half-blocks: each output cell pairs two
 * pixel rows, drawing `█` when both halves share a color, `▀`/`▄` when only one half is opaque, and a
 * two-color `▀` (top fg over bottom bg) when they differ. Transparent pixels leave the cell untouched.
 * Pass `override` to force every opaque pixel to one color (the dim, pre-strike logo state). Clips off-canvas.
 */
function stampPixels(
  buf: Buffer,
  bitmap: readonly string[],
  key: Record<string, Rgb>,
  top: number,
  left: number,
  override?: Rgb,
): void {
  for (let cr = 0; cr * 2 < bitmap.length; cr++) {
    const topRow = bitmap[cr * 2] ?? "";
    const botRow = bitmap[cr * 2 + 1] ?? "";
    const row = buf[top + cr];
    if (!row) continue;
    const cols = Math.max(topRow.length, botRow.length);
    for (let c = 0; c < cols; c++) {
      const x = left + c;
      if (x < 0 || x >= WIDTH) continue;
      const tk = topRow.charAt(c);
      const bk = botRow.charAt(c);
      const topColor = isOpaque(tk) ? (override ?? key[tk] ?? P.dim) : undefined;
      const botColor = isOpaque(bk) ? (override ?? key[bk] ?? P.dim) : undefined;
      if (!topColor && !botColor) continue;
      if (topColor && botColor) {
        row[x] = sameColor(topColor, botColor) ? { ch: "█", fg: topColor } : { ch: "▀", fg: topColor, bg: botColor };
      } else if (topColor) {
        row[x] = { ch: "▀", fg: topColor };
      } else if (botColor) {
        row[x] = { ch: "▄", fg: botColor };
      }
    }
  }
}

/** Draw a line of text onto the buffer at `(top, left)` in one foreground color; spaces are transparent. */
function stampText(buf: Buffer, lines: readonly string[], top: number, left: number, fg: Rgb): void {
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r] ?? "";
    const row = buf[top + r];
    if (!row) continue;
    for (let c = 0; c < line.length; c++) {
      const ch = line.charAt(c);
      const x = left + c;
      if (ch === " " || x < 0 || x >= WIDTH) continue;
      row[x] = { ch, fg };
    }
  }
}

/** Horizontal start column to center a string of `len` chars on the canvas. */
function centerLeft(len: number): number {
  return Math.max(0, Math.floor((WIDTH - len) / 2));
}

/** Horizontal start column to center a string of `len` chars on a given column. */
function centerOn(col: number, len: number): number {
  return Math.max(0, Math.round(col - len / 2));
}

/** Stamp the rocket sprite with its top at `top`, plus a flickering flame folded in just below it. */
function stampRocket(buf: Buffer, top: number, flicker: boolean): void {
  stampPixels(buf, ROCKET_PX, ROCKET_KEY, top, ROCKET_LEFT);
  stampPixels(buf, flicker ? FLAME_B : FLAME_A, FLAME_KEY, top + ROCKET_PX.length / 2, ROCKET_LEFT);
}

/** Stamp both store logos — dim grey while the rocket climbs, full brand color once it strikes. */
function stampLogos(buf: Buffer, lit: boolean): void {
  stampPixels(buf, APPLE_PX, APPLE_KEY, APPLE_TOP, APPLE_LEFT, lit ? undefined : P.dim);
  stampPixels(buf, PLAY_PX, PLAY_KEY, PLAY_TOP, PLAY_LEFT, lit ? undefined : P.dim);
}

/** Stamp the store captions under each logo; on `lit` they gain a green ✓. */
function stampCaptions(buf: Buffer, lit: boolean): void {
  const apple = lit ? "✓ App Store" : "App Store";
  const play = lit ? "✓ Google Play" : "Google Play";
  stampText(buf, [apple], CAPTION_ROW, centerOn(APPLE_LEFT + 6, apple.length), lit ? P.check : P.caption);
  stampText(buf, [play], CAPTION_ROW, centerOn(PLAY_LEFT + 5, play.length), lit ? P.check : P.caption);
}

/** Stamp the `LAUNCH` wordmark (color ramps in over the settle frames) and, once settled, the taglines. */
function stampWordmark(buf: Buffer, color: Rgb, taglines: boolean): void {
  stampText(buf, [WORDMARK], WORD_ROW, centerLeft(WORDMARK.length), color);
  if (taglines) {
    stampText(buf, [TAGLINE_1], TAG_ROW, centerLeft(TAGLINE_1.length), P.tag);
    stampText(buf, [TAGLINE_2], TAG_ROW + 1, centerLeft(TAGLINE_2.length), P.tag);
  }
}

/** Options describing a single composed frame; everything is optional so each phase asks for only what it shows. */
interface SceneOptions {
  /** Rocket top row; omit to draw no rocket (the settle/burst frames). */
  rocketTop?: number;
  flicker?: boolean;
  /** Replace the rocket with an impact sparkle. */
  burst?: boolean;
  /** Light both logos + captions in brand color. */
  lit?: boolean;
  /** Wordmark color; omit to draw no wordmark. */
  wordmark?: Rgb;
  taglines?: boolean;
  /** A short status line at the bottom (`ignition…`, `climbing…`); omit on the settled frames. */
  status?: string;
}

/** Compose one frame's cell buffer from the given scene options. */
function scene(options: SceneOptions): Buffer {
  const buf = blank();
  const lit = options.lit ?? false;
  stampLogos(buf, lit);
  stampCaptions(buf, lit);
  if (options.rocketTop !== undefined) stampRocket(buf, options.rocketTop, options.flicker ?? false);
  if (options.burst) stampText(buf, BURST, APEX_TOP + 1, ROCKET_LEFT + 1, P.flameCore);
  if (options.wordmark) stampWordmark(buf, options.wordmark, options.taglines ?? false);
  if (options.status) stampText(buf, [options.status], STATUS_ROW, centerLeft(options.status.length), P.caption);
  return buf;
}

/** The final resting scene: both logos lit, the full-color wordmark, and the taglines. */
function finalScene(): Buffer {
  return scene({ lit: true, wordmark: P.word, taglines: true });
}

/** Render a row to a string, coalescing runs of same-color cells into one ANSI span (or plain text). */
function renderRow(row: Cell[], depth: ColorDepth): string {
  if (depth === "none") return row.map((cell) => cell.ch).join("");
  let out = "";
  let i = 0;
  while (i < row.length) {
    const fg = row[i]?.fg;
    const bg = row[i]?.bg;
    let text = "";
    while (i < row.length && sameColor(row[i]?.fg, fg) && sameColor(row[i]?.bg, bg)) {
      text += row[i]?.ch ?? " ";
      i++;
    }
    out += paint(text, fg, bg, depth);
  }
  return out;
}

/** Render a whole buffer to a frame string (HEIGHT lines, each WIDTH visible columns). */
function renderBuffer(buf: Buffer, depth: ColorDepth): string {
  return buf.map((row) => renderRow(row, depth)).join("\n");
}

/**
 * The ordered animation frames: liftoff → climb → strike (both stores light) → burst → settle (the
 * wordmark ramps in). 27 frames; pure so it's unit-testable. `depth` controls the embedded color codes
 * (`truecolor`/`ansi256`), or `none` for plain text.
 */
export function buildFrames(depth: ColorDepth = "none"): string[] {
  const buffers: Buffer[] = [];

  for (let i = 0; i < 6; i++) {
    buffers.push(scene({ rocketTop: START_TOP, flicker: i % 2 === 0, status: i < 3 ? "ignition…" : "liftoff…" }));
  }

  const climb = 12;
  for (let i = 0; i < climb; i++) {
    const rocketTop = Math.round(START_TOP - (i / (climb - 1)) * (START_TOP - APEX_TOP));
    buffers.push(scene({ rocketTop, flicker: i % 2 === 0, status: "climbing…" }));
  }

  for (let i = 0; i < 4; i++) {
    buffers.push(scene({ rocketTop: APEX_TOP, flicker: i % 2 === 0, lit: true, status: "delivered to both stores ✓" }));
  }

  buffers.push(scene({ burst: true, lit: true, status: "delivered to both stores ✓" }));

  const ramp: Rgb[] = [P.dim, P.wordDim, P.wordAccent, P.word];
  ramp.forEach((wordmark, i) => {
    buffers.push(scene({ lit: true, wordmark, taglines: i >= 2 }));
  });

  return buffers.map((buf) => renderBuffer(buf, depth));
}

/** The single static banner — used for piped output, logs, and CI. */
export function staticBanner(): string {
  return renderBuffer(finalScene(), "none");
}

/** Whether to animate. Pure so the decision is testable. */
export type BannerMode = "animate" | "static";

/** Animate only on a real interactive TTY that isn't CI and hasn't opted out via `LAUNCH_NO_ANIMATION`. */
export function selectBannerMode(isTTY: boolean, env: NodeJS.ProcessEnv): BannerMode {
  if (!isTTY) return "static";
  if (env["CI"] || env["LAUNCH_NO_ANIMATION"]) return "static";
  return "animate";
}

/** Pick the color depth from the environment: `NO_COLOR` off, truecolor when advertised, else 256-color. */
export function selectColorDepth(env: NodeJS.ProcessEnv): ColorDepth {
  if (env["NO_COLOR"]) return "none";
  const colorterm = (env["COLORTERM"] ?? "").toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "truecolor";
  return "ansi256";
}

/** The minimal writable surface the banner needs — lets tests pass a tiny capture stub. */
export interface BannerStream {
  write(chunk: string): boolean;
}

/** Options for {@link renderBanner}; all injectable so the animation is testable without real I/O or timers. */
export interface RenderBannerOptions {
  stream?: BannerStream;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Per-frame delay in ms (default 75 → ~2s cinematic). */
  frameMs?: number;
  /** Sleep implementation (default `setTimeout`); tests pass an instant resolver. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Print the banner: animated in place on a TTY (redrawing each frame with a cursor-up escape), or a
 * single static frame otherwise. Color depth follows the terminal (`COLORTERM`); `NO_COLOR` drops it.
 * Never throws — a banner failure must not block the CLI.
 */
export async function renderBanner(options: RenderBannerOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? process.stdout.isTTY;
  const env = options.env ?? process.env;

  if (selectBannerMode(isTTY, env) === "static") {
    stream.write(`${staticBanner()}\n`);
    return;
  }

  const frames = buildFrames(selectColorDepth(env));
  const frameMs = options.frameMs ?? 75;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) stream.write(`\x1b[${HEIGHT}A`); // move the cursor up to redraw the canvas in place
    stream.write(`${frames[i] ?? ""}\n`);
    if (i < frames.length - 1) await sleep(frameMs);
  }
}
