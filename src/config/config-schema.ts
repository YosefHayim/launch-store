import type { JsonSchema, SchemaViolation } from './json-schema.ts';
import { loadPublishedConfigSchema, validateLaunchConfig } from './schema.ts';

/** Load and cache the committed JSON Schema used by config commands. */
export function loadConfigSchema(): JsonSchema {
  return loadPublishedConfigSchema();
}

/**
 * Validate a candidate config, returning every violation (empty when valid).
 * Authoring shape: `profiles` required, provider names optional (they default). Unknown keys at any level
 * are flagged. Cross-field semantics are a separate advisory pass (`config-semantics.ts`).
 */
export function validateConfig(candidateConfig: unknown): SchemaViolation[] {
  return validateLaunchConfig(candidateConfig);
}
