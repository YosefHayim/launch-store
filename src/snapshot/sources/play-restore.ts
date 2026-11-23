import type { PlayPriceConfig } from '@/types/catalog.js';
import type { JsonValue } from '@/types/snapshot.js';
import type { PlannedAction } from '@/types/reconcile.js';

/** Narrow a captured {@link JsonValue} to a plain object (rejecting arrays and null), or `null` */
function isJsonRecord(
  capturedNode: JsonValue,
): capturedNode is Readonly<{ [key: string]: JsonValue }> {
  if (typeof capturedNode != 'object') return false;

  if (capturedNode == null) return false;

  if (Array.isArray(capturedNode)) return false;

  return true;
}

export function jsonRecord(
  capturedNode: JsonValue | undefined,
): Readonly<{ [key: string]: JsonValue }> | null {
  if (capturedNode == null) return null;

  if (!isJsonRecord(capturedNode)) return null;

  return capturedNode;
}

/** Read a string-valued field from a captured record, or `undefined` when absent/non-string. */
export function stringField(
  record: Readonly<{ [key: string]: JsonValue }>,
  key: string,
): string | undefined {
  const capturedField = record[key];

  if (typeof capturedField == 'string') return capturedField;

  return undefined;
}

/** Invert a captured money record (`{ priceMicros */
export function readPriceConfig(capturedNode: JsonValue | undefined): PlayPriceConfig | null {
  const record = jsonRecord(capturedNode);

  if (!record) return null;

  const priceMicros = stringField(record, 'priceMicros');
  const currency = stringField(record, 'currency');

  if (priceMicros == null) return null;

  if (currency == null) return null;

  return { priceMicros, currency };
}

/** A skipped {@link PlannedAction} - the restore couldn't act (no account / unrestorable entity) but didn't fail. */
export function skippedAction(description: string): PlannedAction {
  return { description, destructive: false, status: 'skipped' };
}

/** A short message for a thrown value (Play catalog writes carry no secrets). */
export function restoreErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  return String(error);
}
