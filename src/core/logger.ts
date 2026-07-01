/**
 * Launch's two-tier output — the "Aurora Trail" visual identity.
 *
 * By default each pipeline step prints one clean labelled line: a green ✦ mark, a small per-step glyph
 * keyed to what the step does (a wrench for the build, a key-ring for credentials, …), then a bold label
 * and an optional dim detail — so an experienced dev sees a scannable run. With `--explain`, the same
 * step expands into a plain-English teaching block pulled from {@link glossary}; because that text is
 * shared with the docs, the teaching never drifts from the code.
 *
 * Color is the violet→cyan Aurora palette (see {@link import("./aurora.js")}), emitted only on a
 * color-capable TTY. Piped output, log files, CI, and `NO_COLOR` get the same glyphs as plain text, so
 * transcripts stay clean and grep-able. The end-of-run "Shipped" receipt is a violet-ruled box on a TTY,
 * plain labelled lines otherwise (box-drawing misaligns once captured or wrapped).
 */

import { AURORA, auroraPaint, mix, visibleWidth } from './aurora.js';
import { explainTopic, type GlossaryTopic } from './glossary.js';

/** A painter bound to this process's color decision (resolved once at load). */
const paint = auroraPaint();

/** Pause between animation frames (sailing boat, Done checkmark). */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Right-pad to a visible width, ANSI-aware, so the receipt box's right border stays flush. */
const padTo = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - visibleWidth(text)));

/**
 * A small per-step glyph keyed to what the step does, rendered between the ✦ mark and the label. Patterns
 * are specific-first (e.g. `config check` before `config`, `prebuild` ahead of `build`); a label that
 * matches nothing falls back to a neutral dot, so a new step is never glyph-less.
 */
const STEP_ICONS: readonly (readonly [RegExp, string])[] = [
  [/config check/i, '⊞'],
  [/config/i, '⚙'],
  [/account/i, '⊙'],
  [/credential/i, '⊕'],
  [/code signing|sign|certificate|profile|keystore/i, '✎'],
  [/native|prebuild|project/i, '⌘'],
  [/ccache|cache/i, '⚡'],
  [/build/i, '⚒'],
  [/size/i, '▦'],
  [/version/i, '❖'],
  [/upload|submit|distribute/i, '⬆'],
  [/prune|reclaim/i, '♺'],
  [/store|app id|metadata|sync/i, '▣'],
  [/update|rollback/i, '⟳'],
  [/process/i, '◷'],
  [/host|remote|acquire|shred/i, '☁'],
  [/testflight|tester|invit/i, '☉'],
];
const stepIcon = (label: string): string =>
  STEP_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? '·';

/**
 * Title-case a plain lowercase-word label for display (`native project` → `Native Project`), so the step
 * column reads as polished prose rather than terse lowercase. Guarded to pure lowercase words: any label
 * carrying a dot, slash, hyphen, digit, or an existing capital — a bundle id, package name, cert serial,
 * or an app name the user cased themselves — is returned verbatim, since title-casing those would corrupt
 * them. `stepIcon` still keys off the original label (its patterns are case-insensitive).
 */
const PLAIN_LABEL = /^[a-z]+( [a-z]+)*$/;
const prettyLabel = (label: string): string =>
  PLAIN_LABEL.test(label) ? label.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : label;

/**
 * Render a titled, violet-ruled, cyan-titled box (used only on a color TTY) with a per-character
 * violet→cyan top/bottom rule; body rows are padded to the widest line so the right border stays flush
 * regardless of inner color spans. `prefix` leads the title — a `✦ ` marker for the generic
 * {@link Logger.box}, but empty for the "Shipped" receipt, whose sailing boat sits above the box instead.
 */
function receiptBox(title: string, rows: string[], prefix = '✦ '): string[] {
  const titleText = `${prefix}${title}`;
  const innerWidth = Math.max(titleText.length + 4, ...rows.map(visibleWidth));
  const fill = '═'.repeat(Math.max(1, innerWidth - 1 - titleText.length));
  const top = `${paint.gradient('╔═ ', AURORA.violet, AURORA.cyan)}${paint.bold(paint.fg(AURORA.cyan, titleText))}${paint.gradient(` ${fill}╗`, AURORA.violet, AURORA.cyan)}`;
  const body = rows.map(
    (row) =>
      `${paint.fg(AURORA.violet, '║ ')}${padTo(row, innerWidth)}${paint.fg(AURORA.violet, ' ║')}`,
  );
  const bottom = paint.gradient(`╚${'═'.repeat(innerWidth + 2)}╝`, AURORA.violet, AURORA.cyan);
  return [top, ...body, bottom];
}

/**
 * The pixel sailboat (variant "sloop") that sails in above the "Shipped" receipt — the celebratory
 * finale's hero. Plain block-art; each row is colored along the violet→cyan ramp at render time. The
 * last row is the waterline (`≈`); the boat shifts as one rigid block, so {@link padBlock} squares it.
 */
const SHIP_SLOOP = ['   ◢▐', '  ◢█▐', ' ◢██▐', '◢███▐', '▟███▐', '▔▔▔▔▔▔', '▚▄▄▄▄▟', ' ≈≈≈≈ '];

/** Pad every line of a sprite to its widest width so the whole block shifts rigidly during animation. */
function padBlock(art: string[]): string[] {
  const width = Math.max(...art.map((line) => line.length));
  return art.map((line) => line + ' '.repeat(width - line.length));
}

/**
 * Sail the boat in from the left edge with a trailing `≈≈` wake, settle it centered over the receipt
 * width, then bob a couple of times. Purely decorative and TTY-only: it writes cursor moves straight to
 * stdout, so the sole caller ({@link Logger.shipped}) gates it behind {@link AuroraPaint.enabled}.
 */
async function animateShip(width: number): Promise<void> {
  const art = padBlock(SHIP_SLOOP);
  const height = art.length;
  const shipWidth = art[0]?.length ?? 0;
  const restX = Math.max(0, Math.floor((width - shipWidth) / 2));
  const reserved = height + 1; // one row of headroom so the bob has somewhere to rise into

  const colorRow = (raw: string, row: number): string =>
    Array.from(raw, (ch) =>
      ch === ' '
        ? ch
        : paint.fg(mix(AURORA.violet, AURORA.cyan, height < 2 ? 1 : row / (height - 1)), ch),
    ).join('');

  const draw = (xOffset: number, yOffset: number): void => {
    process.stdout.write(`\x1b[${reserved}A`); // back to the top of the reserved canvas
    for (let r = 0; r < reserved; r++) {
      const src = r - yOffset;
      let line = '';
      if (src >= 0 && src < height) {
        const lead =
          src === height - 1 && xOffset > 2
            ? `${' '.repeat(xOffset - 2)}${paint.fg(AURORA.cyan, '≈≈')}` // wake trails the waterline
            : ' '.repeat(Math.max(0, xOffset));
        line = `${lead}${colorRow(art[src] ?? '', src)}`;
      }
      process.stdout.write(`\r\x1b[2K${line}\n`);
    }
  };

  for (let i = 0; i < reserved; i++) process.stdout.write('\n'); // reserve the canvas below the cursor
  const travel = 7;
  for (let f = 0; f <= travel; f++) {
    draw(Math.round(-shipWidth + (restX + shipWidth) * (f / travel)), 1);
    // biome-ignore lint/performance/noAwaitInLoops: animation loop — frames render in order with a delay between them
    await sleep(70);
  }
  for (const yOffset of [0, 1, 0, 1]) {
    draw(restX, yOffset);
    // biome-ignore lint/performance/noAwaitInLoops: animation loop — frames render in order with a delay between them
    await sleep(130);
  }
}

/**
 * A run-scoped logger. Create one per invocation with the resolved `--explain` flag so steps
 * know whether to expand. Keeping this an object (not module functions) lets commands pass it
 * down to the pipeline and providers without a global.
 */
export interface Logger {
  /** A completed step: the ✦ mark, a per-step glyph, a bold label, and an optional short detail. */
  step(label: string, detail?: string, topic?: GlossaryTopic): void;
  /**
   * Wrap a headline value (app name, version, size) in a soft violet "pill" — bg-filled, bold, hair-padded
   * — so it stands out wherever it's interpolated into a step detail or receipt row. Plain (the bare value,
   * no padding) off a TTY. chalk's attribute-specific resets let a chip inside a dimmed detail restore the
   * surrounding dim automatically, so trailing text after the pill stays dim.
   */
  chip(value: string): string;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * A dim, indented hint hung under the step above it — informational, never a warning, so it carries the
   * ⓘ glyph rather than ▲. Used e.g. under the `store` step to note a stored binary is auto-pruned later.
   */
  tip(message: string): void;
  /**
   * A call-to-action block before a decision (e.g. the pre-upload checkpoint): a bold lead line plus
   * dim detail lines, set off by a leading gap so it stands apart from the step stream.
   */
  notice(lead: string, ...details: string[]): void;
  /**
   * A titled summary block. A violet-ruled box on an interactive TTY; plain labelled lines when output
   * isn't a TTY (CI logs, pipes), since box-drawing characters misalign once captured or wrapped.
   */
  box(title: string, rows: string[]): void;
  /**
   * The end-of-run "Shipped" receipt — a sailing pixel boat above the box on an interactive TTY, the
   * celebratory finale. Async because the boat animates; off a TTY it prints the same plain title + rows
   * as {@link box}. Distinct from {@link box} so only this receipt gets the boat (and drops the `✦` title).
   */
  shipped(rows: string[]): Promise<void>;
  /**
   * A plain content line printed verbatim to stdout — the seam's `console.log` passthrough, no glyph.
   * The single owner of raw content output, so a command renders through the logger without gaining a
   * step mark; use {@link step}/{@link box}/{@link notice} when the line wants the Aurora styling.
   */
  line(message: string): void;
  /** A blank line / visual break. */
  gap(): void;
}

/** Build a {@link Logger}. When `explain` is true, steps with a known topic print their teaching block. */
export function createLogger(explain: boolean): Logger {
  return {
    step(label, detail, topic) {
      const tail = detail ? `  ${paint.fg(AURORA.dim, detail)}` : '';
      console.log(
        `${paint.fg(AURORA.green, '✦')} ${paint.fg(AURORA.cyan, stepIcon(label))} ${paint.bold(paint.fg(AURORA.label, prettyLabel(label)))}${tail}`,
      );
      if (explain && topic) {
        for (const line of explainTopic(topic).split('\n'))
          console.log(`  ${paint.fg(AURORA.dim, '│')} ${line}`);
      }
    },
    chip: (value) =>
      paint.enabled
        ? paint.bold(paint.fg(AURORA.label, paint.bg(AURORA.dim, ` ${value} `)))
        : value,
    info: (message) => {
      console.log(`${paint.fg(AURORA.cyan, '→')} ${message}`);
    },
    warn: (message) => {
      console.warn(`${paint.fg(AURORA.amber, '▲')} ${message}`);
    },
    error: (message) => {
      console.error(`${paint.fg(AURORA.pink, '✗')} ${message}`);
    },
    tip: (message) => {
      console.log(
        `   ${paint.fg(AURORA.cyan, 'ⓘ')} ${paint.fg(AURORA.dim, 'tip')}  ${paint.fg(AURORA.dim, message)}`,
      );
    },
    notice: (lead, ...details) => {
      console.log('');
      console.log(`  ${paint.bold(paint.fg(AURORA.label, lead))}`);
      for (const detail of details) console.log(`    ${paint.fg(AURORA.dim, detail)}`);
    },
    box: (title, rows) => {
      if (paint.enabled) {
        for (const line of receiptBox(title, rows)) console.log(line);
        return;
      }
      console.log('');
      console.log(title);
      for (const row of rows) console.log(`  ${row}`);
    },
    shipped: async (rows) => {
      if (!paint.enabled) {
        console.log('');
        console.log('Shipped');
        for (const row of rows) console.log(`  ${row}`);
        return;
      }
      const box = receiptBox('Shipped', rows, ''); // no ✦ — the boat is the title flourish
      await animateShip(Math.max(...box.map(visibleWidth)));
      for (const line of box) console.log(line);
    },
    line: (message) => {
      console.log(message);
    },
    gap: () => {
      console.log('');
    },
  };
}

/**
 * The animated "Done." outro — the wizard's replacement for `@clack/prompts` `outro("Done.")`. On a
 * color TTY a small check builds in place at the closing corner and settles to a green ✓; off a TTY
 * (CI, pipes, tests) it prints the settled line immediately. Mirrors clack's outro frame — a dim gutter
 * bar then the `└` corner — so it sits flush beneath the wizard's prompt stream.
 */
export async function outroDone(): Promise<void> {
  const corner = paint.fg(AURORA.dim, '└');
  const settled = `${corner}  ${paint.bold(paint.fg(AURORA.green, '✓'))} ${paint.fg(AURORA.label, 'Done.')}`;
  console.log(paint.fg(AURORA.dim, '│'));
  if (!paint.enabled) {
    console.log(settled);
    return;
  }
  for (const frame of ['▖', '▗▄', '▝▙▄', '▘▝▙▄']) {
    process.stdout.write(`\r\x1b[2K${corner}  ${paint.fg(AURORA.cyan, frame)}`);
    // biome-ignore lint/performance/noAwaitInLoops: animation loop — frames render in order with a delay between them
    await sleep(80);
  }
  process.stdout.write(`\r\x1b[2K${settled}\n`);
}
