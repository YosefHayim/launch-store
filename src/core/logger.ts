/**
 * Relay's two-tier output.
 *
 * By default each pipeline step prints one clean labelled line, so an experienced dev sees a
 * scannable run. With `--explain`, the same step expands into a plain-English teaching block
 * pulled from {@link glossary} — and because that text is shared with the docs, the teaching
 * never drifts from the code. This is the mechanism behind the "explain the why and the terms" goal.
 */

import { explainTopic, type GlossaryTopic } from "./glossary.js";

const useColor = process.stdout.isTTY;
const paint = (code: string, text: string): string => (useColor ? `[${code}m${text}[0m` : text);

const dim = (t: string): string => paint("2", t);
const bold = (t: string): string => paint("1", t);
const green = (t: string): string => paint("32", t);
const yellow = (t: string): string => paint("33", t);
const red = (t: string): string => paint("31", t);

/**
 * A run-scoped logger. Create one per invocation with the resolved `--explain` flag so steps
 * know whether to expand. Keeping this an object (not module functions) lets commands pass it
 * down to the pipeline and providers without a global.
 */
export interface Logger {
  /** A completed step: a green check, a label, and an optional short detail. */
  step(label: string, detail?: string, topic?: GlossaryTopic): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** A blank line / visual break. */
  gap(): void;
}

/** Build a {@link Logger}. When `explain` is true, steps with a known topic print their teaching block. */
export function createLogger(explain: boolean): Logger {
  return {
    step(label, detail, topic) {
      const tail = detail ? `  ${dim(detail)}` : "";
      console.log(`${green("✓")} ${bold(label)}${tail}`);
      if (explain && topic) {
        const body = explainTopic(topic);
        for (const line of body.split("\n")) console.log(`  ${dim("│")} ${line}`);
      }
    },
    info: (message) => {
      console.log(`${dim("›")} ${message}`);
    },
    warn: (message) => {
      console.warn(`${yellow("⚠")} ${message}`);
    },
    error: (message) => {
      console.error(`${red("✗")} ${message}`);
    },
    gap: () => {
      console.log("");
    },
  };
}
