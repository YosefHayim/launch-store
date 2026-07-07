/**
 * Runtime bridge between the Effect Schema config boundary and the generated JSON Schema artifacts.
 *
 * Validation enters through `config/schema.ts` (ADR 0013). The committed JSON Schema is still loaded
 * from disk for print/render paths while docs generation keeps its temporary zod compatibility source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JsonSchema, SchemaViolation } from './jsonSchema.js';
import { validateLaunchConfig } from './config/schema.js';

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

/** Load (and cache) the committed JSON Schema for `launch.config.ts` (used to print it and render docs). */
export function loadConfigSchema(): JsonSchema {
  cached ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;
  return cached;
}

/**
 * Validate a candidate config against the SSOT schema, returning every violation (empty when it's valid).
 * The value is the authoring shape ({@link import("./config.js").LaunchConfigInput}): `profiles` required,
 * provider names optional (they default). Unknown keys at any level are flagged (the schema is strict),
 * and cross-field semantics are a separate advisory pass (`configSemantics.ts`). Callers decide how to
 * surface the violations and the exit code.
 */
export function validateConfig(value: unknown): SchemaViolation[] {
  return validateLaunchConfig(value);
}
