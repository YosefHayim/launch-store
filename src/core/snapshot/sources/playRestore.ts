import type { PlayPriceConfig } from '@core/types/catalog.js';
import type { JsonValue } from '@core/types/snapshot.js';
import type { PlannedAction } from '@core/types/reconcile.js';
/**
 * Narrow a captured {@link JsonValue} to a plain object (rejecting arrays and null), or `null`, so a
 * malformed captured section is skipped rather than slipping through as an empty record.
 */
export const jsonRecord = (
  capturedNode: JsonValue | undefined,
): Record<string, JsonValue> | null => {
  if (typeof capturedNode !== 'object') return null;
  if (capturedNode === null) return null;
  if (Array.isArray(capturedNode)) return null;
  return capturedNode;
};
/** Read a string-valued field from a captured record, or `undefined` when absent/non-string. */
export const stringField = (record: Record<string, JsonValue>, key: string): string | undefined => {
  const capturedField = record[key];
  if (typeof capturedField === 'string') return capturedField;
  return undefined;
};
/**
 * Invert a captured money record (`{ priceMicros, currency }`) back into a {@link PlayPriceConfig}. Both
 * fields are required - a partial price (one half dropped at capture) can't be restored, so it yields
 * `null` and the caller drops it rather than writing an invalid price.
 */
export const toPriceConfig = (capturedNode: JsonValue | undefined): PlayPriceConfig | null => {
  const record = jsonRecord(capturedNode);
  if (!record) return null;
  const priceMicros = stringField(record, 'priceMicros');
  const currency = stringField(record, 'currency');
  if (priceMicros === undefined) return null;
  if (currency === undefined) return null;
  return { priceMicros, currency };
};
/** A skipped {@link PlannedAction} - the restore couldn't act (no account / unrestorable entity) but didn't fail. */
export const skippedAction = (description: string): PlannedAction => {
  return { description, destructive: false, status: 'skipped' };
};
/** A short message for a thrown value (Play catalog writes carry no secrets). */
export const restoreErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};
