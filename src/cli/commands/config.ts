/**
 * `launch config` — work with the typed `launch.config.ts` schema. Three read-only subcommands over the
 * generated JSON Schema (`schema/launch.config.schema.json`, derived from the config types):
 *   - `config schema [--out]` emits the JSON Schema, so an editor can autocomplete and validate a config;
 *   - `config validate [file]` checks a config against it (the project's `launch.config.ts`, or a `.json`
 *     file an agent wrote) and points at each offending field;
 *   - `config docs` prints the field reference (the same content committed as `docs/config.md`).
 *
 * Thin glue: the schema is loaded/validated by `core/configSchema.ts` and rendered by
 * `core/docs/configDocs.ts`, so this only wires the commander surface and the output. See issue #173.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { Command } from "commander";
import { findLaunchConfig } from "../../core/config.js";
import type { FoundConfig } from "../../core/config.js";
import { loadConfigSchema, validateConfig } from "../../core/configSchema.js";
import { renderConfigDocs } from "../../core/docs/configDocs.js";
import { createLogger } from "../../core/logger.js";
import type { Logger } from "../../core/logger.js";
import type { SchemaViolation } from "../../core/jsonSchema.js";

/** Options for `config schema`. */
interface SchemaOptions {
  /** Write the schema to this file (to reference via `$schema`) instead of printing it to stdout. */
  out?: string;
}

/** Print a config's validation result — a success box, or each violation as `path: message` with a non-zero exit. */
function reportViolations(log: Logger, violations: SchemaViolation[], source: string): void {
  if (violations.length === 0) {
    log.box("Config valid", [`✓ ${source} matches the schema`]);
    return;
  }
  for (const violation of violations) log.warn(`${violation.path || "(root)"}: ${violation.message}`);
  log.gap();
  log.error(`${violations.length} problem${violations.length === 1 ? "" : "s"} in ${source}.`);
  process.exitCode = 1;
}

/** Emit the JSON Schema: to `--out` (with a hint to wire `$schema`), or to stdout so it can be piped. */
function runSchema(options: SchemaOptions): void {
  const json = `${JSON.stringify(loadConfigSchema(), null, 2)}\n`;
  if (options.out === undefined) {
    process.stdout.write(json);
    return;
  }
  writeFileSync(options.out, json);
  createLogger(false).box("Schema written", [
    `✓ wrote ${options.out}`,
    "Reference it via a `$schema` key (in a JSON config) or your editor for autocomplete + validation.",
  ]);
}

/**
 * Validate a config against the schema. With no `file`, load the project's `launch.config.ts` (post-
 * `defineConfig`, so this catches wrong types/enums/nested shapes but not already-dropped unknown
 * top-level keys); with a `.json` file, validate it verbatim — the full shape, including unknown keys —
 * which is the AI/programmatic path. A non-JSON file argument is rejected with a usage hint.
 */
async function runValidate(file: string | undefined): Promise<void> {
  const log = createLogger(false);

  if (file === undefined) {
    let found: FoundConfig | null;
    try {
      found = await findLaunchConfig();
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    if (!found) {
      log.error("No launch.config.{ts,mjs,js} in this directory. Pass a .json file, or run `launch init` first.");
      process.exitCode = 1;
      return;
    }
    reportViolations(log, validateConfig(found.config), found.path);
    return;
  }

  if (!file.endsWith(".json")) {
    log.error("`launch config validate` takes a .json file, or no argument to validate launch.config.ts.");
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    log.error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  reportViolations(log, validateConfig(parsed), file);
}

/** Attach the `config` command group and its `schema`/`validate`/`docs` subcommands to the program. */
export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description(
      "work with the launch.config.ts schema — emit JSON Schema, validate a config, or print the field reference",
    );

  config
    .command("schema")
    .description("print the JSON Schema for launch.config.ts (generated from the config types)")
    .option("--out <file>", "write the schema to this file instead of stdout")
    .action((options: SchemaOptions) => {
      runSchema(options);
    });

  config
    .command("validate")
    .argument("[file]", "a .json config to validate (default: the launch.config.ts in the current directory)")
    .description("validate a config against the schema, reporting each problem with its field path")
    .action(async (file: string | undefined) => {
      await runValidate(file);
    });

  config
    .command("docs")
    .description("print the launch.config.ts field reference (the same content as docs/config.md)")
    .action(() => {
      process.stdout.write(renderConfigDocs(loadConfigSchema()));
    });
}
