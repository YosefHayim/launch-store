/**
 * The `launch` ASCII banner — the "Aurora Trail" lift-off, shown on the no-args front door (just before
 * the interactive wizard). A rocket **fires left→right across the X-axis**, punching through the pixel-art
 * Apple then Google Play logos (each dim until the rocket strikes it, then lit in its real brand color),
 * and settles into the violet→cyan "L A U N C H" wordmark.
 *
 * It's drawn as **half-block pixel art**, not text art. Every frame is composed on a fixed-size cell
 * buffer (a HEIGHT×WIDTH grid of {@link Cell}s); each cell can carry a foreground *and* a background
 * color and a half-block glyph (`▀`/`▄`/`█`), so a single character encodes two stacked pixels — top half
 * in the foreground color, bottom half in the background. That doubles the vertical resolution and smooths
 * the diagonals, which is how terminal image renderers (chafa, viu, timg) draw crisp logos. Sprites are
 * authored as RGB pixel bitmaps and their pixel-row pairs are folded into half-block cells at stamp time.
 *
 * The brand store/rocket hexes stay exact (silver rocket, the four Play facets); the Aurora violet→cyan
 * (see {@link import("./aurora.js")}) runs through the wordmark, the rule, and the status dot. Color is
 * truecolor (24-bit) where the terminal advertises it (`COLORTERM`), otherwise downsampled to 256-color;
 * `NO_COLOR` and the static/piped/CI path render plain text. Only a real interactive TTY animates;
 * everywhere else prints one static frame so transcripts stay clean. The frame-builder and mode/depth
 * selection are pure so they're unit-testable; {@link renderBanner} takes an injectable stream + sleep.
 */

import { AURORA, mix } from "./aurora.js";

/** Banner canvas size. Every frame is exactly this many rows/cols so each redraw overwrites cleanly. */
const WIDTH = 64;
const HEIGHT = 13;

/** An sRGB color as a `[r, g, b]` triple (0–255). Emitted as truecolor, or downsampled to 256-color. */
export type Rgb = readonly [number, number, number];

/**
 * The brand palette for the pixel sprites — the real store/rocket hexes (Google's
 * #4285F4/#34A853/#FBBC04/#EA4335 facets, silver Apple/rocket, cyan window), so they're exact under
 * truecolor and close under the 256-color fallback. Honored only when color is enabled; the static/piped
 * and `NO_COLOR` paths render every cell as plain text. The Aurora wordmark/rule colors come from
 * {@link AURORA}.
 */
const BP = {
  rocket: [214, 216, 222],
  nose: [232, 72, 58],
  window: [88, 198, 255],
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
} as const satisfies Record<string, Rgb>;

/** Top-left of each store logo (on the right of the canvas) and the rows reserved for text. */
const APPLE_TOP = 0;
const APPLE_LEFT = 37;
const PLAY_TOP = 1;
const PLAY_LEFT = 53;
/** The rocket's fixed cell-row; it travels horizontally along this row, drawn over the logos → "through". */
const ROCKET_ROW = 2;
const WORD_ROW = 8;
const RULE_ROW = 9;
const TAG_ROW = 10;
const STATUS_ROW = 12;
/** The rocket's left column travels from off-screen left to past Play; its nose leads by this many columns. */
const START_X = -8;
const END_X = PLAY_LEFT + 8;
const NOSE_OFFSET = 7;

/**
 * The right-pointing rocket as a pixel bitmap (`w` silver body, window `o`, `n`ose). 4 pixel rows fold
 * into 2 half-block character rows; see {@link ROCKET_KEY} for the key→color map. A flame trails to the
 * left, alternated frame-to-frame for flicker; a short sparkle marks each logo strike.
 */
const ROCKET_PX = ["   wwwn  ", " wwwwwonn", " wwwwwonn", "   wwwn  "] as const;
const FLAME_A = ["  ttooy", " ttoooy", " ttoooy", "  ttooy"] as const;
const FLAME_B = ["   tooy", "  ttooy", "  ttooy", "   tooy"] as const;
const BURST_PX = ["  y  ", " yoy ", "yotoy", " yoy ", "  y  "] as const;

/**
 * The Apple logo as a pixel bitmap (`a` silver body, `l` green leaf), traced 1:1 from the official vector
 * by rasterizing its filled silhouette: the two top lobes with a center cleft, the leaf tilted up-right,
 * the bite on the right edge, and the two feet with a center notch. 14 pixel rows fold into 7 half-block
 * rows. Dim grey until the rocket strikes it, then full color.
 */
const APPLE_PX = [
  "            ll",
  "  aaaa  aaalll",
  " aaaaaaaaaall",
  "aaaaaaaaaaal",
  "aaaaaaaaaaaa",
  "aaaaaaaaaaa",
  "aaaaaaaaaaa",
  "aaaaaaaaaaaa",
  "aaaaaaaaaaaa",
  " aaaaaaaaaaaa",
  " aaaaaaaaaaaa",
  " aaaaaaaaaaaa",
  "  aaaaaaaaaa",
  "   aaa  aaa",
] as const;

/**
 * Build the Google Play logo as a four-facet pixel bitmap from geometry, so the triangle's edges are
 * exact rather than hand-stepped. A right-pointing triangle (top-left and bottom-left corners, a centered
 * right apex) whose four facets meet at the centroid: `b`lue upper-left and `r`ed lower-left hug the left
 * edge, `g`reen spans the top and `y`ellow the bottom, meeting at the apex. An even `h` folds into `h / 2`
 * half-block rows; trailing spaces are transparent.
 */
function buildPlayBitmap(w: number, h: number): string[] {
  const centerX = w / 3; // the centroid sits a third in from the vertical left edge
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
const ROCKET_KEY: Record<string, Rgb> = { w: BP.rocket, o: BP.window, n: BP.nose };
const FLAME_KEY: Record<string, Rgb> = { t: BP.flameTip, o: BP.flameMid, y: BP.flameCore };
const APPLE_KEY: Record<string, Rgb> = { a: BP.apple, l: BP.leaf };
const PLAY_KEY: Record<string, Rgb> = { b: BP.playBlue, g: BP.playGreen, r: BP.playRed, y: BP.playYellow };

const WORDMARK = "L A U N C H";
const RULE_WIDTH = Math.min(52, WIDTH - 4);
const TAGLINE = "ship iOS + Android from your own machine";
/** Status the static / settled frames carry, so even piped output names both stores. */
const FINAL_STATUS = "delivered to the App Store + Google Play ✓";

/**
 * One terminal cell: a single glyph plus optional foreground/background colors. For half-block pixel art
 * the glyph is `▀`/`▄`/`█` with `fg` = the top pixel and `bg` = the bottom pixel; for text it's the
 * character with `fg` only. Both colors `undefined` renders the glyph with no ANSI escape.
 */
export interface Cell {
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
 * Fold a pixel bitmap onto the buffer at `(top, left)` as half-blocks: each output cell pairs two pixel
 * rows, drawing `█` when both halves share a color, `▀`/`▄` when only one half is opaque, and a two-color
 * `▀` (top fg over bottom bg) when they differ. Transparent pixels leave the cell untouched. Pass
 * `override` to force every opaque pixel to one color (the dim, pre-strike logo state). Clips off-canvas.
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
      const topColor = isOpaque(tk) ? (override ?? key[tk] ?? BP.dim) : undefined;
      const botColor = isOpaque(bk) ? (override ?? key[bk] ?? BP.dim) : undefined;
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
function stampText(buf: Buffer, line: string, top: number, left: number, fg: Rgb): void {
  const row = buf[top];
  if (!row) return;
  for (let c = 0; c < line.length; c++) {
    const ch = line.charAt(c);
    const x = left + c;
    if (ch === " " || x < 0 || x >= WIDTH) continue;
    row[x] = { ch, fg };
  }
}

/** Draw a line of text with a per-character `from`→`to` gradient — the Aurora wordmark and rule. */
function stampGradient(buf: Buffer, line: string, top: number, left: number, from: Rgb, to: Rgb): void {
  const row = buf[top];
  if (!row) return;
  for (let c = 0; c < line.length; c++) {
    const ch = line.charAt(c);
    const x = left + c;
    if (ch === " " || x < 0 || x >= WIDTH) continue;
    row[x] = { ch, fg: mix(from, to, line.length < 2 ? 0 : c / (line.length - 1)) };
  }
}

/** Horizontal start column to center a string of `len` chars on the canvas. */
function centerLeft(len: number): number {
  return Math.max(0, Math.floor((WIDTH - len) / 2));
}

/** Stamp both store logos — dim grey until the rocket strikes, then full brand color. */
function stampLogos(buf: Buffer, hitApple: boolean, hitPlay: boolean): void {
  stampPixels(buf, APPLE_PX, APPLE_KEY, APPLE_TOP, APPLE_LEFT, hitApple ? undefined : BP.dim);
  stampPixels(buf, PLAY_PX, PLAY_KEY, PLAY_TOP, PLAY_LEFT, hitPlay ? undefined : BP.dim);
}

/** Stamp the rocket at column `x`, with a flickering exhaust folded in just to its left. */
function stampRocket(buf: Buffer, x: number, flicker: boolean): void {
  stampPixels(buf, flicker ? FLAME_A : FLAME_B, FLAME_KEY, ROCKET_ROW, x - 6);
  stampPixels(buf, ROCKET_PX, ROCKET_KEY, ROCKET_ROW, x);
}

/** Stamp the impact sparkle that flashes for a couple of frames when the rocket punches through a logo. */
function stampBurst(buf: Buffer, col: number): void {
  stampPixels(buf, BURST_PX, FLAME_KEY, ROCKET_ROW - 1, col - 2);
}

/** Stamp a status line — a cyan dot plus a dim message — centered at the bottom. */
function stampStatus(buf: Buffer, message: string): void {
  const line = `• ${message}`;
  const left = centerLeft(line.length);
  stampText(buf, "•", STATUS_ROW, left, AURORA.cyan);
  stampText(buf, message, STATUS_ROW, left + 2, AURORA.dim);
}

/** How the wordmark renders in a given frame: hidden, dim (just appearing), or the full violet→cyan gradient. */
type WordmarkStage = "none" | "dim" | "full";

/** Stamp the `LAUNCH` wordmark (and, once full, the gradient rule beneath it). */
function stampWordmark(buf: Buffer, stage: WordmarkStage): void {
  if (stage === "none") return;
  const left = centerLeft(WORDMARK.length);
  if (stage === "dim") {
    stampText(buf, WORDMARK, WORD_ROW, left, BP.dim);
    return;
  }
  stampGradient(buf, WORDMARK, WORD_ROW, left, AURORA.violet, AURORA.cyan);
  stampGradient(buf, "▂".repeat(RULE_WIDTH), RULE_ROW, centerLeft(RULE_WIDTH), AURORA.violet, AURORA.cyan);
}

/** Options describing a single composed frame; everything is optional so each phase asks for only what it shows. */
interface SceneOptions {
  /** Rocket left column; omit to draw no rocket (the settle frames). */
  rocketX?: number;
  flicker?: boolean;
  hitApple?: boolean;
  hitPlay?: boolean;
  /** Column of the impact sparkle, omit for none. */
  burstCol?: number;
  wordmark?: WordmarkStage;
  taglines?: boolean;
  /** A short status line at the bottom (`ignition…`, `→ delivered to the App Store ✓`). */
  status?: string;
}

/** Compose one frame's cell buffer from the given scene options. */
function scene(options: SceneOptions): Buffer {
  const buf = blank();
  stampLogos(buf, options.hitApple ?? false, options.hitPlay ?? false);
  if (options.rocketX !== undefined) stampRocket(buf, options.rocketX, options.flicker ?? false);
  if (options.burstCol !== undefined) stampBurst(buf, options.burstCol);
  stampWordmark(buf, options.wordmark ?? "none");
  if (options.taglines) stampText(buf, TAGLINE, TAG_ROW, centerLeft(TAGLINE.length), AURORA.dim);
  if (options.status) stampStatus(buf, options.status);
  return buf;
}

/** The final resting scene: both logos lit, the gradient wordmark + rule, and the tagline. */
function finalScene(): Buffer {
  return scene({ hitApple: true, hitPlay: true, wordmark: "full", taglines: true, status: FINAL_STATUS });
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

/** Render a whole buffer to a frame string: one line per row, same-color cell runs coalesced. */
export function renderBuffer(buf: Buffer, depth: ColorDepth): string {
  return buf.map((row) => renderRow(row, depth)).join("\n");
}

/**
 * The ordered animation frames: ignition → flight (the rocket fires across, lighting each store as it
 * punches through) → settle (the wordmark ramps in). Pure so it's unit-testable. `depth` controls the
 * embedded color codes (`truecolor`/`ansi256`), or `none` for plain text.
 */
export function buildFrames(depth: ColorDepth = "none"): string[] {
  const buffers: Buffer[] = [];

  for (let i = 0; i < 4; i++) {
    buffers.push(scene({ rocketX: START_X, flicker: i % 2 === 0, status: "ignition…" }));
  }

  let hitApple = false;
  let hitPlay = false;
  let status = "liftoff…";
  let burst: { col: number; frames: number } | null = null;
  let frame = 0;
  for (let x = START_X; x <= END_X; x += 2, frame++) {
    if (burst && --burst.frames <= 0) burst = null;
    const nose = x + NOSE_OFFSET;
    if (!hitApple && nose >= APPLE_LEFT + 4) {
      hitApple = true;
      burst = { col: APPLE_LEFT + 6, frames: 2 };
      status = "→ delivered to the App Store ✓";
    }
    if (!hitPlay && nose >= PLAY_LEFT + 3) {
      hitPlay = true;
      burst = { col: PLAY_LEFT + 4, frames: 2 };
      status = "→ delivered to Google Play ✓";
    }
    buffers.push(
      scene({
        rocketX: x,
        flicker: frame % 2 === 0,
        hitApple,
        hitPlay,
        ...(burst ? { burstCol: burst.col } : {}),
        status,
      }),
    );
  }

  buffers.push(scene({ hitApple: true, hitPlay: true, wordmark: "dim", status: FINAL_STATUS }));
  buffers.push(scene({ hitApple: true, hitPlay: true, wordmark: "full", status: FINAL_STATUS }));
  buffers.push(finalScene());

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
  /** Per-frame delay in ms (default 60 → a brisk ~2.5s flight). */
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
  const frameMs = options.frameMs ?? 60;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) stream.write(`\x1b[${HEIGHT}A`); // move the cursor up to redraw the canvas in place
    stream.write(`${frames[i] ?? ""}\n`);
    if (i < frames.length - 1) await sleep(frameMs);
  }
}
