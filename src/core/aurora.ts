/**
 * The "Aurora Trail" visual identity — one source of truth for Launch's violet→cyan palette and the
 * small truecolor helpers its TUI surfaces share (the step {@link import("./logger.js") logger}, the
 * build {@link import("./progress.js") progress bar}, and the {@link import("./banner.js") banner}'s
 * wordmark). Centralizing the palette here keeps the brand colors from drifting across the three
 * renderers — change a hue once, here.
 *
 * Color is emitted only when the caller opts in (a color-capable TTY). Off a TTY, under `NO_COLOR`, or
 * in CI every helper returns plain text, so logs, pipes, and captured transcripts stay clean and
 * grep-able.
 *
 * The truecolor escapes are emitted by `chalk` — the de-facto terminal-styling library — through a
 * `Chalk` instance pinned to `level: 3` (24-bit). We pin the level so OUR {@link colorEnabled} gate
 * (a real TTY without `NO_COLOR`), not chalk's own environment autodetection, is the single switch that
 * decides plain-vs-colored; this keeps the decision identical across the logger, progress bar, and
 * banner. chalk also closes styles with attribute-specific resets (`\x1b[39m`/`\x1b[49m`/`\x1b[22m`)
 * rather than a blanket `\x1b[0m`, so nested spans — e.g. a {@link AuroraPaint.bg} value-chip inside a
 * dimmed line — restore the surrounding color automatically. The {@link AURORA} palette below stays the
 * single source of truth for the hues; chalk is only the renderer.
 */

import { Chalk } from 'chalk';

/** A truecolor chalk instance pinned to 24-bit so {@link colorEnabled}, not chalk autodetection, gates color. */
const chalk = new Chalk({ level: 3 });

/** An sRGB color as a `[r, g, b]` triple (0–255), emitted as a 24-bit truecolor SGR escape. */
export type Rgb = readonly [number, number, number];

/**
 * The Aurora palette. Each surface picks the roles it needs; the two anchors are `violet` → `cyan`,
 * the gradient that runs through the wordmark, the progress-bar fill, and the receipt rule.
 */
export const AURORA = {
  violet: [167, 139, 250],
  cyan: [34, 211, 238],
  green: [74, 222, 128],
  amber: [251, 191, 36],
  pink: [244, 114, 182],
  dim: [110, 102, 140],
  label: [237, 233, 254],
} as const satisfies Record<string, Rgb>;

/** Whether truecolor should be emitted: an interactive stdout that hasn't opted out via `NO_COLOR`. */
export function colorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stdout.isTTY,
): boolean {
  return isTTY && env['NO_COLOR'] == null;
}

/** Linear interpolation between two colors — used for per-character gradients and the bar fill ramp. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Visible width of a string, ignoring ANSI SGR escapes — so colored text still pads/aligns correctly. */
export function visibleWidth(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * A painter bound to a single color decision, so a module resolves {@link colorEnabled} once at load and
 * then paints freely. When disabled every method returns its text untouched — the plain, non-TTY path.
 */
export interface AuroraPaint {
  /** Whether this painter emits color (false → every method is identity). */
  readonly enabled: boolean;
  /** Wrap text in a truecolor foreground. */
  fg(color: Rgb, text: string): string;
  /** Wrap text in a truecolor background — the fill behind a highlighted "chip" (e.g. a value pill). */
  bg(color: Rgb, text: string): string;
  /** Embolden text. */
  bold(text: string): string;
  /** Paint each character of `text` along a `from`→`to` gradient (spaces left untouched). */
  gradient(text: string, from: Rgb, to: Rgb): string;
}

/** Build an {@link AuroraPaint}. Defaults to the live {@link colorEnabled} decision; pass `false` to force plain. */
export function auroraPaint(enabled: boolean = colorEnabled()): AuroraPaint {
  if (!enabled) {
    return {
      enabled,
      fg: (_color, text) => text,
      bg: (_color, text) => text,
      bold: (text) => text,
      gradient: (text) => text,
    };
  }
  const fg = ([r, g, b]: Rgb, text: string): string => chalk.rgb(r, g, b)(text);
  return {
    enabled,
    fg,
    bg: ([r, g, b], text) => chalk.bgRgb(r, g, b)(text),
    bold: (text) => chalk.bold(text),
    gradient: (text, from, to) =>
      Array.from(text, (ch, i) =>
        ch === ' ' ? ch : fg(mix(from, to, text.length < 2 ? 0 : i / (text.length - 1)), ch),
      ).join(''),
  };
}
