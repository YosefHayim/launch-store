/**
 * The runtime bridge between the config SSOT ({@link LaunchConfigSchema}) and the two things that read a
 * JSON Schema rather than the zod object: printing (`launch config schema`) and the rendered field
 * reference (`launch config docs` → `docs/config.md`).
 *
 * Validation goes straight through zod — {@link validateConfig} runs {@link LaunchConfigSchema}'s
 * `safeParse` and maps each issue to a {@link SchemaViolation}, so there's no second validator to keep in
 * sync (see [ADR 0008](../../docs/adr/0008-adopt-zod-config-ssot.md)). The committed JSON Schema is still
 * GENERATED from the same schema by `npm run docs:gen` (`z.toJSONSchema`) and committed at
 * `schema/launch.config.schema.json`; this module just loads that file for the print/render paths.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { JsonSchema, SchemaViolation } from './jsonSchema.js';
import { LaunchConfigSchema } from './types/config.js';

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

/** Format a zod issue path (`["profiles", "production", "sizeBudgetMB"]`) as the dotted/bracketed string callers show. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (typeof segment === 'string' && /^[A-Za-z_$][\w$]*$/.test(segment))
      out += out ? `.${segment}` : segment;
    else out += `[${JSON.stringify(String(segment))}]`;
  }
  return out;
}

/**
 * Map one zod issue to the {@link SchemaViolation}s callers report. An `unrecognized_keys` issue carries
 * every stray key on `keys` (at the parent object's path), so it fans out to one violation per key —
 * matching the AI/programmatic contract that each unknown key is flagged at its own path (#197). Every
 * other issue is a single violation at its path with zod's message.
 */
function issueToViolations(issue: z.core.$ZodIssue): SchemaViolation[] {
  if (issue.code === 'unrecognized_keys')
    return issue.keys.map((key) => ({
      path: formatPath([...issue.path, key]),
      message: 'unknown property',
    }));
  return [{ path: formatPath(issue.path), message: issue.message }];
}

/**
 * Validate a candidate config against the SSOT schema, returning every violation (empty when it's valid).
 * The value is the authoring shape ({@link import("./config.js").LaunchConfigInput}): `profiles` required,
 * provider names optional (they default). Unknown keys at any level are flagged (the schema is strict),
 * and cross-field semantics are a separate advisory pass (`configSemantics.ts`). Callers decide how to
 * surface the violations and the exit code.
 */
export function validateConfig(value: unknown): SchemaViolation[] {
  const result = LaunchConfigSchema.safeParse(value);
  return result.success ? [] : result.error.issues.flatMap(issueToViolations);
}
