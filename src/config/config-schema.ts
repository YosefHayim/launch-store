// Loads the published schema and validates a Launch config for the config commands.

import type { JsonSchema, SchemaViolation } from './json-schema.ts';
import { loadPublishedConfigSchema, validateLaunchConfig } from './schema.ts';

/** Load and cache the committed JSON Schema used by config commands. */
export function loadConfigSchema(): JsonSchema {
  return loadPublishedConfigSchema();
}

/** Validate a candidate config, returning every violation (empty when valid). */
export function validateConfig(candidateConfig: unknown): SchemaViolation[] {
  return validateLaunchConfig(candidateConfig);
}
