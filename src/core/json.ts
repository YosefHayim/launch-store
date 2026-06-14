/**
 * Tiny JSON-narrowing helper shared by the App Store Connect reconcilers. Kept in its own module
 * (rather than re-derived per feature) so there's one definition of "is this a plain object?" for the
 * strict, array-rejecting case the reconcilers' config parsers rely on.
 */

/**
 * Narrow an unknown value to a plain object, or `null`. **Arrays are rejected** — an array is
 * `typeof "object"` but not a record — so a malformed config section like `categories: []` fails loudly
 * instead of slipping through as an empty record.
 *
 * This is the strict variant the ASC reconcilers use. The Expo-config parsers
 * (`config.ts` / `configCheck.ts` / `storeConfig.ts` / `updateCheck.ts`) deliberately keep a looser,
 * array-permissive copy, so they are intentionally not routed through here.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
