import type { ColorDepth } from './halfblock.js';
import { buildRocketFrames, renderRocketBanner } from './rocketScene.js';
import { Effect } from 'effect';
/** The single static banner - the settled scene's plain-text tagline, for piped output, logs, and CI. */
export const staticBanner = (): string => {
  return renderRocketBanner('none');
};
/** Whether to animate. Pure so the decision is testable. */
export type BannerMode = 'animate' | 'static';
/** Animate only on a real interactive TTY that isn't CI and hasn't opted out via `LAUNCH_NO_ANIMATION`. */
export const selectBannerMode = (isTTY: boolean, env: NodeJS.ProcessEnv): BannerMode => {
  if (!isTTY) return 'static';
  if (env['CI']) return 'static';
  if (env['LAUNCH_NO_ANIMATION']) return 'static';
  return 'animate';
};
/** Pick the color depth from the environment: `NO_COLOR` off, truecolor when advertised, else 256-color. */
export const selectColorDepth = (env: NodeJS.ProcessEnv): ColorDepth => {
  if (env['NO_COLOR']) return 'none';
  let colorTerminal = env['COLORTERM'];
  if (colorTerminal === undefined) colorTerminal = '';
  const advertisedColorDepth = colorTerminal.toLowerCase();
  if (advertisedColorDepth.includes('truecolor')) return 'truecolor';
  if (advertisedColorDepth.includes('24bit')) return 'truecolor';
  return 'ansi256';
};
/** The minimal writable surface the banner needs - lets tests pass a tiny capture stub. */
export type BannerStream = {
  write(chunk: string): boolean;
};
/** Options for {@link renderBanner}; all injectable so the animation is testable without real I/O or timers. */
export type RenderBannerOptions = {
  stream: BannerStream;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
  frameMs?: number;
  sleep?: (milliseconds: number) => Effect.Effect<void>;
};
/**
 * Print the banner: animated in place on a TTY (redrawing each frame with a cursor-up escape sized to the
 * frame's own height), or a single static frame otherwise. Color depth follows the terminal (`COLORTERM`);
 * `NO_COLOR` collapses the scene to the plain tagline in one frame, since the bloom and logos need color.
 */
export const renderBanner = (options: RenderBannerOptions): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { stream, isTTY, env } = options;
    if (selectBannerMode(isTTY, env) === 'static') {
      stream.write(`${staticBanner()}\n`);
      return;
    }
    const frames = buildRocketFrames(selectColorDepth(env));
    const firstFrame = frames[0];
    if (firstFrame === undefined) return;
    const frameHeight = firstFrame.split('\n').length;
    let frameDelayMilliseconds = options.frameMs;
    if (frameDelayMilliseconds === undefined) frameDelayMilliseconds = 70;
    let waitForNextFrame = options.sleep;
    if (waitForNextFrame === undefined) waitForNextFrame = Effect.sleep;
    for (const [frameIndex, frameText] of frames.entries()) {
      if (frameIndex > 0) stream.write(`\x1b[${frameHeight}A`);
      stream.write(`${frameText}\n`);
      if (frameIndex < frames.length - 1) yield* waitForNextFrame(frameDelayMilliseconds);
    }
  });
