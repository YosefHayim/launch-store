/**
 * Half-block terminal pixel primitives — the shared, art-agnostic rendering core.
 *
 * Terminal "pixel art" packs two stacked pixels into one character cell: an upper-half `▀` (or lower
 * `▄`, or full `█`) glyph whose foreground color is the top pixel and background color is the bottom.
 * That doubles vertical resolution and is how image renderers (chafa, viu, timg) draw crisp logos. This
 * module owns the {@link Cell}/{@link Rgb} shapes, the color-depth downsampling, and {@link renderBuffer}
 * which folds a grid of cells into an ANSI (or plain-text) string.
 *
 * It carries no sprites or layout of its own — the {@link import("./banner.js")} orchestration and the
 * {@link import("./wordmark.js")} glow logotype both build grids of these cells and hand them here to
 * render, so there is exactly one half-block encoder, not one per artwork.
 */

/** An sRGB color as a `[r, g, b]` triple (0–255). Emitted as truecolor, or downsampled to 256-color. */
export type Rgb = readonly [number, number, number];

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

/** A rectangular grid of cells (rows of columns) — one composed frame, rendered by {@link renderBuffer}. */
export type Grid = Cell[][];

/** How much color to emit. `truecolor` for exact brand hex, `ansi256` for the downsampled fallback. */
export type ColorDepth = "none" | "ansi256" | "truecolor";

/** Value-equality for optional colors, so same-color cell runs coalesce into one ANSI span. */
function sameColor(a?: Rgb, b?: Rgb): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
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

/** Render a whole grid to a frame string: one line per row, same-color cell runs coalesced. */
export function renderBuffer(grid: Grid, depth: ColorDepth): string {
  return grid.map((row) => renderRow(row, depth)).join("\n");
}
