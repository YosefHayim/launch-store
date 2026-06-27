/**
 * The runtime bridge to the committed JSON Schema for `launch.config.ts`.
 *
 * The schema itself is GENERATED from the config types (`LaunchConfigInput` in `config.ts`, derived
 * from `src/core/types.ts`) by `npm run docs:gen` and committed at `schema/launch.config.schema.json`,
 * so the types stay the single source of truth and `docs:check` gates any drift. This module just loads
 * that committed file at runtime and pairs it with the hand-rolled {@link validate} from `jsonSchema.ts`,
 * so `launch config schema/validate/docs` and any programmatic caller share one schema with no second
 * copy to keep in sync. Heavy SDK-free: it reads one JSON file, no generator at runtime.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type JsonSchema, type SchemaViolation, validate } from './jsonSchema.js';

/**
 * Absolute path to the committed schema, resolved relative to THIS module so it points at the copy that
 * actually ships: `<root>/schema/…` under vitest (`src/core/configSchema.ts`) and `<pkgroot>/schema/…`
 * in the published tarball (`dist/core/configSchema.js`) — the `../../` lands on the package root from
 * either tree, the same trick {@link import("./config.js")}'s `SELF_ENTRY` uses for the public entry.
 */
const SCHEMA_PATH = fileURLToPath(
  new URL('../../schema/launch.config.schema.json', import.meta.url),
);

/** Memoized parse of the committed schema — it's immutable at runtime, so read and parse it once. */
let cached: JsonSchema | undefined;

/** Load (and cache) the committed JSON Schema for `launch.config.ts`. */
export function loadConfigSchema(): JsonSchema {
  cached ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;
  return cached;
}

/**
 * Validate a candidate config against the committed schema, returning every violation (empty when it's
 * valid). The value is the authoring shape ({@link import("./config.js").LaunchConfigInput}): `profiles`
 * required, provider names optional. Callers decide how to surface the violations and the exit code.
 */
export function validateConfig(value: unknown): SchemaViolation[] {
  return validate(value, loadConfigSchema());
}
