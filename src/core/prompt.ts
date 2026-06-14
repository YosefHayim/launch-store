/**
 * Shared "pick one of many" prompt — the single home for the type-to-search picker so the app picker
 * and the credentials key picker behave identically (issue #11). A small flat list uses clack's
 * `select`; past {@link PICK_SEARCH_THRESHOLD} it becomes a fuzzy type-to-search `autocomplete`, so a
 * 60-app monorepo doesn't overflow the viewport. The non-interactive policy is explicit per call site
 * because the safe default differs: refusing to guess which app to BUILD vs. taking the newest key.
 */

import { autocomplete, cancel, isCancel, select } from "@clack/prompts";

/** Above this many options, the flat list becomes a fuzzy type-to-search prompt. */
export const PICK_SEARCH_THRESHOLD = 8;

/**
 * Subsequence fuzzy match: every character of `query` must appear in `haystack` in order, case-
 * insensitively (so `"pmd"` matches `"pomedero"`). Dependency-free; powers {@link pickOne}'s filter
 * over big lists without pulling in a ranking library.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = haystack.toLowerCase();
  let n = 0;
  for (let h = 0; h < hay.length && n < needle.length; h++) {
    if (hay[h] === needle[n]) n++;
  }
  return n === needle.length;
}

/**
 * One selectable choice. `value` is returned verbatim; `label` is displayed and searched; the optional
 * `hint` (e.g. a bundle id or tildified path) is shown dimmed and is also matched by the fuzzy filter.
 */
export interface PickOption<T> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * What {@link pickOne} does when it can't prompt (no TTY / `--yes` / piped input):
 * - `require` — throw `"<message> <flagHint>"`, refusing to guess (used where a wrong guess is costly,
 *   e.g. which app to build → the error tells the user to pass `--app`).
 * - `fallback` — return `value` (used where a sensible default exists, e.g. the newest key); an optional
 *   `note` is printed so the user knows a choice was made for them and how to override it.
 */
export type NonInteractivePolicy<T> =
  | { kind: "require"; flagHint: string }
  | { kind: "fallback"; value: T; note?: string };

/** Arguments to {@link pickOne}. Callers resolve the 0- and 1-option cases before calling. */
export interface PickOneArgs<T> {
  /** The prompt question; also the lead of a `require` non-interactive error. */
  message: string;
  /** The choices to offer. */
  options: PickOption<T>[];
  /** Whether an interactive prompt is possible; false applies {@link nonInteractive}. */
  canPrompt: boolean;
  /** Behavior when `canPrompt` is false. */
  nonInteractive: NonInteractivePolicy<T>;
  /** Override the flat-list → search cutoff (default {@link PICK_SEARCH_THRESHOLD}). */
  searchThreshold?: number;
}

/**
 * Prompt for one choice, scaling the UI to the list size and degrading safely without a TTY. Cancelling
 * (Ctrl-C) exits the process cleanly, matching the rest of the CLI's prompts.
 */
export async function pickOne<T>(args: PickOneArgs<T>): Promise<T> {
  if (!args.canPrompt) {
    if (args.nonInteractive.kind === "fallback") {
      if (args.nonInteractive.note) console.log(args.nonInteractive.note);
      return args.nonInteractive.value;
    }
    throw new Error(`${args.message} ${args.nonInteractive.flagHint}`);
  }

  // clack's `Option` type is conditional on the value being a primitive, so drive the prompt with string
  // indices (always a clean `Option<string>`) and map the choice back to the caller's value — that keeps
  // `pickOne` generic over any value type. The truthy ternary omits `hint` when unset, since `hint:
  // undefined` trips exactOptionalPropertyTypes.
  const options = args.options.map((option, index) =>
    option.hint
      ? { value: String(index), label: option.label, hint: option.hint }
      : { value: String(index), label: option.label },
  );
  const threshold = args.searchThreshold ?? PICK_SEARCH_THRESHOLD;
  const choice =
    args.options.length > threshold
      ? await autocomplete({
          message: args.message,
          options,
          placeholder: "Type to search…",
          maxItems: 10,
          filter: (search, option) => fuzzyMatch(search, `${option.label} ${option.hint ?? ""}`),
        })
      : await select({ message: args.message, options });
  if (isCancel(choice)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  const picked = args.options[Number(choice)];
  if (!picked) throw new Error("pickOne: the selection did not match a provided option.");
  return picked.value;
}
