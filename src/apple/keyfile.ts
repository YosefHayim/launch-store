/**
 * Locating and identifying an App Store Connect API key (`.p8`) file.
 *
 * Apple downloads the key as `AuthKey_<KEYID>.p8`, so the Key ID is already encoded in the filename.
 * These helpers let `launch creds set-key` auto-discover the file in `~/Downloads` and pull the Key ID
 * out of its name, instead of asking you to copy/paste either one. Pure + filesystem-only (no prompts),
 * so they're unit-testable and reusable by the first-run wizard.
 */

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

/** Apple's key filename: `AuthKey_` + the Key ID (10-char alphanumeric) + `.p8`. */
const AUTH_KEY_FILENAME = /^AuthKey_([A-Z0-9]{8,})\.p8$/i;

/** Extract the Key ID from an `AuthKey_<KEYID>.p8` path, upper-cased, or null if the name doesn't match. */
export function extractKeyId(p8Path: string): string | null {
  const captured = AUTH_KEY_FILENAME.exec(basename(p8Path))?.[1];
  return captured ? captured.toUpperCase() : null;
}

/** List `AuthKey_*.p8` files in `dir` as absolute paths (name-sorted, newest-looking first). Missing/unreadable dir → []. */
export function findAuthKeyFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => AUTH_KEY_FILENAME.test(name))
      .sort()
      .reverse()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Reconcile an explicitly-supplied Key ID (flag/env) with the one read from the `.p8` filename.
 *
 * Throws when both are present and disagree — that almost always means the wrong file or the wrong
 * `--key-id` was passed, and silently trusting either would store a key that can't authenticate.
 * Returns the chosen Key ID (upper-cased), or undefined when neither source has one.
 */
export function reconcileKeyId(explicit: string | undefined, fromFilename: string | null): string | undefined {
  const normalizedExplicit = explicit?.trim().toUpperCase();
  if (normalizedExplicit && fromFilename && normalizedExplicit !== fromFilename) {
    throw new Error(
      `Key ID ${normalizedExplicit} doesn't match the key file (AuthKey_${fromFilename}.p8). ` +
        `Check you passed the right --key-id and .p8.`,
    );
  }
  return normalizedExplicit ?? fromFilename ?? undefined;
}
