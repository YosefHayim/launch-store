/**
 * The `launch` ASCII banner — an animated rocket lift-off that delivers to the App Store and Google
 * Play, shown on the no-args front door and on `--help`.
 *
 * It degrades safely: only a real interactive TTY (and not CI) gets the animation; everywhere else —
 * piped output, log files, CI — prints a single static frame so transcripts stay clean. The
 * frame-builder and mode selection are pure so they're unit-testable; {@link renderBanner} takes an
 * injectable stream + sleep so the animation can be tested without real timers.
 */

/** Banner canvas size. Frames are padded to exactly these dimensions so each redraw overwrites cleanly. */
const WIDTH = 46;
const HEIGHT = 8;

/** The rocket glyph (top-to-bottom), drawn at {@link ROCKET_COL}. */
const ROCKET = [" /\\", "|••|", "|LC|", "/__\\"];
const ROCKET_COL = 20;

/** Pad/truncate a line to exactly {@link WIDTH} so a shorter frame line fully overwrites a longer one. */
function row(content: string): string {
  return content.length >= WIDTH ? content.slice(0, WIDTH) : content.padEnd(WIDTH);
}

/** A line with `text` centred in the canvas. */
function center(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return row(" ".repeat(pad) + text);
}

/** A line with `left` and `right` pushed to the canvas edges. */
function between(left: string, right: string): string {
  const gap = Math.max(1, WIDTH - left.length - right.length);
  return row(left + " ".repeat(gap) + right);
}

/**
 * One animation frame: the rocket at vertical `altitude` (lower = higher up the canvas), with the two
 * store targets on the top row and `caption` on the bottom row. `hit` lights the targets with a ✓.
 */
function sceneFrame(altitude: number, hit: boolean, caption: string): string {
  const lines = Array.from({ length: HEIGHT }, () => row(""));
  lines[0] = between(hit ? "[✓]  App Store" : "[ ]  App Store", hit ? "Google Play  [✓]" : "Google Play  [ ]");
  ROCKET.forEach((glyph, i) => {
    const r = altitude + i;
    if (r >= 1 && r < HEIGHT - 1) lines[r] = row(" ".repeat(ROCKET_COL) + glyph);
  });
  const exhaust = altitude + ROCKET.length;
  if (!hit && exhaust >= 1 && exhaust < HEIGHT - 1) lines[exhaust] = row(" ".repeat(ROCKET_COL + 1) + "^^");
  lines[HEIGHT - 1] = center(caption);
  return lines.join("\n");
}

/** The final, static frame: lit targets, the LAUNCH wordmark, and the tagline. Also the non-TTY fallback. */
function finalFrame(): string {
  return [
    between("[✓]  App Store", "Google Play  [✓]"),
    row(""),
    center("L  A  U  N  C  H   🚀"),
    row(""),
    center("ship iOS + Android from your own machine"),
    center("— your keys, your hardware, no Expo bill —"),
    row(""),
    row(""),
  ].join("\n");
}

/** The ordered animation frames: ignition → climb → both stores hit → final wordmark. Pure. */
export function buildFrames(): string[] {
  return [
    sceneFrame(3, false, "ignition…"),
    sceneFrame(2, false, "liftoff…"),
    sceneFrame(1, false, "climbing…"),
    sceneFrame(1, true, "delivered to both stores ✓"),
    finalFrame(),
  ];
}

/** The single static banner — used for piped output, logs, and CI. */
export function staticBanner(): string {
  return finalFrame();
}

/** Whether to animate. Pure so the decision is testable. */
export type BannerMode = "animate" | "static";

/** Animate only on a real interactive TTY that isn't CI and hasn't opted out via `LAUNCH_NO_ANIMATION`. */
export function selectBannerMode(isTTY: boolean, env: NodeJS.ProcessEnv): BannerMode {
  if (!isTTY) return "static";
  if (env["CI"] || env["LAUNCH_NO_ANIMATION"]) return "static";
  return "animate";
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
  /** Per-frame delay in ms (default 220). */
  frameMs?: number;
  /** Sleep implementation (default `setTimeout`); tests pass an instant resolver. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Print the banner: animated in place on a TTY (redrawing each frame with a cursor-up escape), or a
 * single static frame otherwise. Never throws — a banner failure must not block the CLI.
 */
export async function renderBanner(options: RenderBannerOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? process.stdout.isTTY;
  const env = options.env ?? process.env;

  if (selectBannerMode(isTTY, env) === "static") {
    stream.write(`${staticBanner()}\n`);
    return;
  }

  const frames = buildFrames();
  const frameMs = options.frameMs ?? 220;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) stream.write(`[${HEIGHT}A`); // move the cursor up to redraw the canvas in place
    stream.write(`${frames[i] ?? ""}\n`);
    if (i < frames.length - 1) await sleep(frameMs);
  }
}
