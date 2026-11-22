import type { JsonSchema, SchemaViolation } from './jsonSchema.ts';
import { loadPublishedConfigSchema, validateLaunchConfig } from './schema.ts';

/** Load and cache the committed JSON Schema used by config commands and MCP tools. */
export function loadConfigSchema(): JsonSchema {
  return loadPublishedConfigSchema();
}

/**
 * Validate a candidate config, returning every violation (empty when valid).
 * Authoring shape: `profiles` required, provider names optional (they default). Unknown keys at any level
 * are flagged. Cross-field semantics are a separate advisory pass (`configSemantics.ts`).
 */
export function validateConfig(candidateConfig: unknown): SchemaViolation[] {
  return validateLaunchConfig(candidateConfig);
}
