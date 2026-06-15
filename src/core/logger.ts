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

import { AURORA, auroraPaint, visibleWidth } from "./aurora.js";
import { explainTopic, type GlossaryTopic } from "./glossary.js";

/** A painter bound to this process's color decision (resolved once at load). */
const paint = auroraPaint();

/** Right-pad to a visible width, ANSI-aware, so the receipt box's right border stays flush. */
const padTo = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

/**
 * A small per-step glyph keyed to what the step does, rendered between the ✦ mark and the label. Patterns
 * are specific-first (e.g. `config check` before `config`, `prebuild` ahead of `build`); a label that
 * matches nothing falls back to a neutral dot, so a new step is never glyph-less.
 */
const STEP_ICONS: readonly (readonly [RegExp, string])[] = [
  [/config check/i, "⊞"],
  [/config/i, "⚙"],
  [/account/i, "⊙"],
  [/credential/i, "⊕"],
  [/code signing|sign|certificate|profile|keystore/i, "✎"],
  [/native|prebuild|project/i, "⌘"],
  [/ccache|cache/i, "⚡"],
  [/build/i, "⚒"],
  [/size/i, "▦"],
  [/version/i, "❖"],
  [/upload|submit|distribute/i, "▲"],
  [/prune|reclaim/i, "♺"],
  [/store|app id|metadata|sync/i, "▣"],
  [/update|rollback/i, "⟳"],
  [/process/i, "◷"],
  [/host|remote|acquire|shred/i, "☁"],
  [/testflight|tester|invit/i, "☉"],
];
const stepIcon = (label: string): string => STEP_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? "·";

/**
 * Render the "Shipped" receipt as a violet-ruled, cyan-titled box (used only on a color TTY). The title
 * gets a `✦ ` prefix and a per-character violet→cyan top/bottom rule; body rows are padded to the widest
 * line so the right border stays flush regardless of inner color spans.
 */
function receiptBox(title: string, rows: string[]): string[] {
  const titleText = `✦ ${title}`;
  const innerWidth = Math.max(titleText.length + 4, ...rows.map(visibleWidth));
  const fill = "═".repeat(Math.max(1, innerWidth - 1 - titleText.length));
  const top = `${paint.gradient("╔═ ", AURORA.violet, AURORA.cyan)}${paint.bold(paint.fg(AURORA.cyan, titleText))}${paint.gradient(` ${fill}╗`, AURORA.violet, AURORA.cyan)}`;
  const body = rows.map(
    (row) => `${paint.fg(AURORA.violet, "║ ")}${padTo(row, innerWidth)}${paint.fg(AURORA.violet, " ║")}`,
  );
  const bottom = paint.gradient(`╚${"═".repeat(innerWidth + 2)}╝`, AURORA.violet, AURORA.cyan);
  return [top, ...body, bottom];
}

/**
 * A run-scoped logger. Create one per invocation with the resolved `--explain` flag so steps
 * know whether to expand. Keeping this an object (not module functions) lets commands pass it
 * down to the pipeline and providers without a global.
 */
export interface Logger {
  /** A completed step: the ✦ mark, a per-step glyph, a bold label, and an optional short detail. */
  step(label: string, detail?: string, topic?: GlossaryTopic): void;
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
   * A titled summary block — the end-of-run "Shipped" receipt. A violet-ruled box on an interactive TTY;
   * plain labelled lines when output isn't a TTY (CI logs, pipes), since box-drawing characters misalign
   * once captured or wrapped.
   */
  box(title: string, rows: string[]): void;
  /** A blank line / visual break. */
  gap(): void;
}

/** Build a {@link Logger}. When `explain` is true, steps with a known topic print their teaching block. */
export function createLogger(explain: boolean): Logger {
  return {
    step(label, detail, topic) {
      const tail = detail ? `  ${paint.fg(AURORA.dim, detail)}` : "";
      console.log(
        `${paint.fg(AURORA.green, "✦")} ${paint.fg(AURORA.cyan, stepIcon(label))} ${paint.bold(paint.fg(AURORA.label, label))}${tail}`,
      );
      if (explain && topic) {
        for (const line of explainTopic(topic).split("\n")) console.log(`  ${paint.fg(AURORA.dim, "│")} ${line}`);
      }
    },
    info: (message) => {
      console.log(`${paint.fg(AURORA.cyan, "→")} ${message}`);
    },
    warn: (message) => {
      console.warn(`${paint.fg(AURORA.amber, "▲")} ${message}`);
    },
    error: (message) => {
      console.error(`${paint.fg(AURORA.pink, "✗")} ${message}`);
    },
    tip: (message) => {
      console.log(`   ${paint.fg(AURORA.cyan, "ⓘ")} ${paint.fg(AURORA.dim, "tip")}  ${paint.fg(AURORA.dim, message)}`);
    },
    notice: (lead, ...details) => {
      console.log("");
      console.log(`  ${paint.bold(paint.fg(AURORA.label, lead))}`);
      for (const detail of details) console.log(`    ${paint.fg(AURORA.dim, detail)}`);
    },
    box: (title, rows) => {
      if (paint.enabled) {
        for (const line of receiptBox(title, rows)) console.log(line);
        return;
      }
      console.log("");
      console.log(title);
      for (const row of rows) console.log(`  ${row}`);
    },
    gap: () => {
      console.log("");
    },
  };
}
