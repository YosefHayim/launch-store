/**
 * Shared inversion primitives for the Google Play snapshot sources' `restore` pass — the small set of
 * helpers both {@link import("./playProducts.js").playProductsSource} and
 * {@link import("./playSubscriptions.js").playSubscriptionsSource} use to read a captured entity's
 * normalized `data` back into the config shapes their reconcilers consume.
 *
 * A captured entity's `data` is a {@link JsonValue} (the on-disk form), so these narrow it field-by-field
 * without casts — the JsonValue-typed sibling of `core/json.ts`'s `asRecord`, kept here because the
 * snapshot layer works in {@link JsonValue}, not `unknown`.
 */

import type { JsonValue } from "../types.js";
import type { PlannedAction } from "../../ascSync.js";
import type { PlayPriceConfig } from "../../types.js";

/**
 * Narrow a captured {@link JsonValue} to a plain object (rejecting arrays and null), or `null`. The
 * JsonValue-typed counterpart of `core/json.ts`'s `asRecord`, so a malformed captured section is skipped
 * rather than slipping through as an empty record.
 */
export function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

/** Read a string-valued field from a captured record, or `undefined` when absent/non-string. */
export function stringField(record: Record<string, JsonValue>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Invert a captured money record (`{ priceMicros, currency }`) back into a {@link PlayPriceConfig}. Both
 * fields are required — a partial price (one half dropped at capture) can't be restored, so it yields
 * `null` and the caller drops it rather than writing an invalid price.
 */
export function toPriceConfig(value: JsonValue | undefined): PlayPriceConfig | null {
  const record = jsonRecord(value);
  if (!record) return null;
  const priceMicros = stringField(record, "priceMicros");
  const currency = stringField(record, "currency");
  return priceMicros !== undefined && currency !== undefined ? { priceMicros, currency } : null;
}

/** A skipped {@link PlannedAction} — the restore couldn't act (no account / unrestorable entity) but didn't fail. */
export function skippedAction(description: string): PlannedAction {
  return { description, destructive: false, status: "skipped" };
}

/** A short message for a thrown value (Play catalog writes carry no secrets). */
export function restoreErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
