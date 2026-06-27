/**
 * `npm run wordmark:preview` — play the glowing pixel-art LAUNCH wordmark (the `launch` banner) in the
 * terminal on its own, looping a few times so the style is easy to inspect. Animated in place on a TTY
 * (a few breathe + shimmer loops), one static frame when piped. Color depth follows the terminal.
 *
 * Like the other `scripts/*.ts`, this is dev I/O orchestration — not built or linted — kept
 * prettier-clean so `format:check` stays green.
 */

import process from 'node:process';
import { selectColorDepth } from '../src/core/banner.ts';
import { buildGlowFrames, renderGlowWordmark } from '../src/core/wordmark.ts';

const depth = selectColorDepth(process.env);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${renderGlowWordmark(depth)}\n`);
    return;
  }

  const frames = buildGlowFrames(depth);
  const height = (frames[0] ?? '').split('\n').length;
  process.stdout.write('\x1b[?25l'); // hide the cursor while animating
  try {
    for (let loop = 0; loop < 4; loop++) {
      for (let i = 0; i < frames.length; i++) {
        if (!(loop === 0 && i === 0)) {
          process.stdout.write(`\x1b[${height}A`); // redraw in place
        }
        process.stdout.write(`${frames[i] ?? ''}\n`);
        await sleep(70);
      }
    }
  } finally {
    process.stdout.write('\x1b[?25h'); // restore the cursor
  }
}

void main();
