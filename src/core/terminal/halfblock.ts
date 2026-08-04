export type Rgb = readonly [number, number, number];
/** One terminal character with optional foreground and background colors. */
export type Cell = {
  ch: string;
  fg?: Rgb;
  bg?: Rgb;
};
/** A rectangular grid of cells (rows of columns) - one composed frame, rendered by {@link renderBuffer}. */
export type Grid = Cell[][];
/** How much color to emit. `truecolor` for exact brand hex, `ansi256` for the downsampled fallback. */
export type ColorDepth = 'none' | 'ansi256' | 'truecolor';
/** Value-equality for optional colors, so same-color cell runs coalesce into one ANSI span. */
const sameColor = (a?: Rgb, b?: Rgb): boolean => {
  if (a === b) return true;
  if (!a) return false;
  if (!b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
};
/** Downsample RGB to the nearest xterm-256 code: greys use the ramp, colors use the 6x6x6 cube. */
const to256 = ([r, g, b]: Rgb): number => {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const channel = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * channel(r) + 6 * channel(g) + channel(b);
};
/** Build one SGR color parameter for the 38 (foreground) or 48 (background) channel at a given depth. */
const colorParam = (channel: 38 | 48, rgb: Rgb, depth: ColorDepth): string => {
  if (depth === 'truecolor') return `${channel};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  return `${channel};5;${to256(rgb)}`;
};
/** Wrap text in an SGR sequence for the given fg/bg. Built with `\x1b` (no raw byte) to stay greppable. */
const paint = (
  text: string,
  fg: Rgb | undefined,
  bg: Rgb | undefined,
  depth: ColorDepth,
): string => {
  if (depth === 'none') return text;
  if (!fg && !bg) return text;
  const params: string[] = [];
  if (fg) params.push(colorParam(38, fg, depth));
  if (bg) params.push(colorParam(48, bg, depth));
  return `\x1b[${params.join(';')}m${text}\x1b[0m`;
};
/** Render a row to a string, coalescing runs of same-color cells into one ANSI span (or plain text). */
const renderRow = (cellRow: readonly Cell[], depth: ColorDepth): string => {
  if (depth === 'none') return cellRow.map((cell) => cell.ch).join('');
  let out = '';
  let i = 0;
  while (i < cellRow.length) {
    const currentCell = cellRow[i];
    if (currentCell === undefined) break;
    const fg = currentCell.fg;
    const bg = currentCell.bg;
    let text = '';
    while (i < cellRow.length) {
      const runCell = cellRow[i];
      if (runCell === undefined) break;
      if (!sameColor(runCell.fg, fg)) break;
      if (!sameColor(runCell.bg, bg)) break;
      text += runCell.ch;
      i++;
    }
    out += paint(text, fg, bg, depth);
  }
  return out;
};
/** Render a whole grid to a frame string: one line per row, same-color cell runs coalesced. */
export const renderBuffer = (grid: Grid, depth: ColorDepth): string => {
  return grid.map((cellRow) => renderRow(cellRow, depth)).join('\n');
};
