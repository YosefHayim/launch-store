import { Chalk } from 'chalk';
/** A truecolor chalk instance pinned to 24-bit so {@link colorEnabled}, not chalk autodetection, gates color. */
const chalk = new Chalk({ level: 3 });
/** An sRGB color as a `[r, g, b]` triple (0-255), emitted as a 24-bit truecolor SGR escape. */
export type Rgb = readonly [number, number, number];
/**
 * The Aurora palette. Each surface picks the roles it needs; the two anchors are `violet` -> `cyan`,
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
export type ColorEnvironment = Readonly<Record<string, string | undefined>>;
export const colorEnabled = (env: ColorEnvironment, isTTY: boolean): boolean => {
  return isTTY && env['NO_COLOR'] == null;
};
/** Linear interpolation between two colors - used for per-character gradients and the bar fill ramp. */
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
};
/** Visible width of a string, ignoring ANSI SGR escapes - so colored text still pads/aligns correctly. */
export const visibleWidth = (text: string): number => {
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
};
/**
 * A painter bound to a single color decision, so a module resolves {@link colorEnabled} once at load and
 * then paints freely. When disabled every method returns its text untouched - the plain, non-TTY path.
 */
export type AuroraPaint = {
  readonly enabled: boolean;
  fg(color: Rgb, text: string): string;
  bg(color: Rgb, text: string): string;
  bold(text: string): string;
  gradient(text: string, from: Rgb, to: Rgb): string;
};
/** Build an {@link AuroraPaint}. Defaults to the live {@link colorEnabled} decision; pass `false` to force plain. */
export const auroraPaint = (enabled: boolean): AuroraPaint => {
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
      Array.from(text, (character, characterIndex) => {
        if (character === ' ') return character;
        let fraction = 0;
        if (text.length >= 2) fraction = characterIndex / (text.length - 1);
        return fg(mix(from, to, fraction), character);
      }).join(''),
  };
};
