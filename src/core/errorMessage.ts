/**
 * Tiny error-narrowing helper shared across the reconcilers, `doctor`, `setup`, and the compute
 * providers. Kept in its own module (rather than re-derived per feature) so there's one definition of
 * "how do we read a message off an unknown thrown value?" — mirrors `asRecord` in `json.ts`.
 */

/**
 * Read a human-readable message off an unknown thrown value. An `Error` contributes its `.message`;
 * anything else (a thrown string, number, or object) is coerced with `String`. This is the canonical
 * form for the `catch (error)` blocks that record a failure on a reconciler action or surface it to the
 * user, none of which carry secrets.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
