/**
 * JSON-narrowing helpers shared by the App Store Connect reconcilers. Kept in its own module so
 * there's one definition of "is this a plain object?" for the strict, array-rejecting case the
 * reconcilers' config parsers rely on.
 */

import { Effect } from 'effect';

/**
 * Narrow an unknown value to a plain object, or `null`. **Arrays are rejected** — an array is
 * `typeof "object"` but not a record — so a malformed config section like `categories: []` fails
 * loudly instead of slipping through as an empty record.
 */
export const narrowToRecord = (value: unknown) =>
  Effect.sync((): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null,
  );

// ─── Imperative shim (callers migrate progressively) ───────────────────────

/** Imperative shim — use {@link narrowToRecord} in new code. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
