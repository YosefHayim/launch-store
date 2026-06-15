/**
 * The `launch` banner — a cinematic pixel-art scene shown on the no-args front door (just before the
 * interactive wizard): a silver rocket streaks across a starfield, igniting the LAUNCH STORE wordmark in
 * its wake and charging the Apple + Google Play badges, then the lockup holds with a breathing neon glow.
 *
 * This module is just the orchestration: it picks the animate-vs-static {@link BannerMode} and the
 * {@link ColorDepth} from the environment, then drives {@link renderBanner}'s output loop. The artwork
 * itself lives in {@link import("./rocketScene.js")} (sprites, bloom, and frames) and is encoded by the
 * shared {@link import("./halfblock.js")} half-block renderer. The mode/depth selectors are pure so
 * they're unit-testable; {@link renderBanner} takes an injectable stream + sleep so the animation runs
 * with no real TTY or timers in tests.
 */

import { type ColorDepth } from "./halfblock.js";
import { buildRocketFrames, renderRocketBanner } from "./rocketScene.js";

/** The single static banner — the settled scene's plain-text tagline, for piped output, logs, and CI. */
export function staticBanner(): string {
  return renderRocketBanner("none");
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
  /** Per-frame delay in ms (default 70 → one ~1.7s breathe + shimmer pass). */
  frameMs?: number;
  /** Sleep implementation (default `setTimeout`); tests pass an instant resolver. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Print the banner: animated in place on a TTY (redrawing each frame with a cursor-up escape sized to the
 * frame's own height), or a single static frame otherwise. Color depth follows the terminal (`COLORTERM`);
 * `NO_COLOR` collapses the scene to the plain tagline in one frame, since the bloom and logos need color.
 */
export async function renderBanner(options: RenderBannerOptions = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const isTTY = options.isTTY ?? process.stdout.isTTY;
  const env = options.env ?? process.env;

  if (selectBannerMode(isTTY, env) === "static") {
    stream.write(`${staticBanner()}\n`);
    return;
  }

  const frames = buildRocketFrames(selectColorDepth(env));
  const height = (frames[0] ?? "").split("\n").length;
  const frameMs = options.frameMs ?? 70;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) stream.write(`\x1b[${height}A`); // move the cursor up to redraw the wordmark in place
    stream.write(`${frames[i] ?? ""}\n`);
    if (i < frames.length - 1) await sleep(frameMs);
  }
}
