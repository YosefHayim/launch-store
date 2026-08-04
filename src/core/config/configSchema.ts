import { FileSystem } from '@effect/platform';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { type JsonSchema, JsonSchemaNode, type SchemaViolation } from './jsonSchema.js';
import { validateLaunchConfig } from './schema.js';
/**
 * Absolute path to the committed schema, resolved relative to THIS module so it points at the copy that
 * actually ships: `<root>/schema/...` under vitest (`src/core/config/configSchema.ts`) and
 * `<pkgroot>/schema/...` in the published tarball (`dist/core/config/configSchema.js`) - the `../../../`
 * lands on the package root from either tree, the same trick {@link import("./config.js")}'s
 * `SELF_ENTRY` uses for the public entry.
 */
const SCHEMA_PATH = fileURLToPath(
  new URL('../../../schema/launch.config.schema.json', import.meta.url),
);
/** Memoized parse of the committed schema - it's immutable at runtime, so read and parse it once. */
let cached: JsonSchema | undefined;
/** Load and cache the committed JSON Schema used by config commands and MCP tools. */
export const loadConfigSchema = (): Effect.Effect<JsonSchema, unknown, FileSystem.FileSystem> => {
  if (cached !== undefined) return Effect.succeed(cached);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const schemaText = yield* fileSystem.readFileString(SCHEMA_PATH);
    const loadedSchema = yield* Schema.decodeUnknown(Schema.parseJson(JsonSchemaNode))(schemaText);
    cached = loadedSchema;
    return loadedSchema;
  });
};
/**
 * Validate a candidate config against the SSOT schema, returning every violation (empty when it's valid).
 * The value is the authoring shape ({@link import("./config.js").LaunchConfigInput}): `profiles` required,
 * provider names optional (they default). Unknown keys at any level are flagged (the schema is strict),
 * and cross-field semantics are a separate advisory pass (`configSemantics.ts`). Callers decide how to
 * surface the violations and the exit code.
 */
export const validateConfig = (candidateConfig: unknown): SchemaViolation[] => {
  return validateLaunchConfig(candidateConfig);
};
