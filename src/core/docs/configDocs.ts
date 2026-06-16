/**
 * Pure rendering behind `launch config docs` and the committed `docs/config.md`.
 *
 * The sibling of `commandDocs.ts`: where that turns the command tree into `docs/commands.md`, this turns
 * the GENERATED JSON Schema for `launch.config.ts` (`schema/launch.config.schema.json`, produced from the
 * config types by `npm run docs:gen`) into a human/agent-readable field reference. Driving both the CLI
 * output and the committed markdown from the one schema means the reference can't drift from the types —
 * and `docs:check` gates it, exactly like the command reference.
 *
 * Deliberately free of `fs`/prettier (the script owns I/O) so it stays trivially unit-testable, and it only
 * reads the draft-07 subset {@link import("../jsonSchema.js").JsonSchema} the generator emits.
 */

import { escapeCell } from "./commandDocs.js";
import type { JsonSchema } from "../jsonSchema.js";

/** Decode the trailing segment of a `$ref` into the definition name, e.g. `#/definitions/BuildProfile` → `BuildProfile`. */
function refName(ref: string): string {
  return decodeURIComponent(ref.split("/").pop() ?? "");
}

/**
 * Resolve a `{@link Foo}` / `{@link Foo display}` / `{@link Foo | display}` tag down to plain text: the
 * display label when one is given, otherwise the symbol's last path segment (stripping any
 * `import("…").` prefix the generator emits). Keeps the reference readable instead of leaking TSDoc tags.
 */
function resolveLink(inner: string): string {
  const [target, ...rest] = inner.split("|");
  if (rest.length > 0) return rest.join("|").trim();

  const trimmed = (target ?? "").trim();
  const space = trimmed.search(/\s/);
  if (space !== -1) return trimmed.slice(space + 1).trim();

  const symbol = trimmed.replace(/^import\([^)]*\)\./, "");
  return symbol.split(".").pop() ?? symbol;
}

/** Strip `{@link}` tags and collapse all whitespace so a JSDoc block renders as one clean table-cell line. */
export function cleanDescription(description: string | undefined): string {
  if (!description) return "";
  return description
    .replace(/\{@link\s+([^}]+)\}/g, (_match, inner: string) => resolveLink(inner))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a property's schema as a TypeScript-flavoured type string: `$ref`→the def name, `enum`→a literal
 * union, arrays→`T[]`, `Record<…>` from an open object, and `anyOf`/`oneOf`/`allOf` joined. Recursive, so
 * nested arrays and maps read naturally (`Record<string, BuildProfile>`, `string[]`).
 */
function renderType(schema: JsonSchema): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if ("const" in schema) return JSON.stringify(schema.const);
  if (schema.anyOf) return schema.anyOf.map(renderType).join(" | ");
  if (schema.oneOf) return schema.oneOf.map(renderType).join(" | ");
  if (schema.allOf) return schema.allOf.map(renderType).join(" & ");

  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("array")) return `${schema.items ? renderType(schema.items) : "unknown"}[]`;
  if (types.includes("object")) {
    return typeof schema.additionalProperties === "object"
      ? `Record<string, ${renderType(schema.additionalProperties)}>`
      : "object";
  }
  return types.length > 0 ? types.join(" | ") : "unknown";
}

/** Render an object schema's properties as a `Field | Type | Required | Description` table (or a note when it has none). */
function renderPropertiesTable(object: JsonSchema): string {
  const properties = Object.entries(object.properties ?? {});
  if (properties.length === 0) return "_No documented fields._";

  const required = new Set(object.required ?? []);
  const rows = properties.map(([name, property]) => {
    const type = `\`${escapeCell(renderType(property))}\``;
    const need = required.has(name) ? "Yes" : "No";
    return `| \`${name}\` | ${type} | ${need} | ${escapeCell(cleanDescription(property.description))} |`;
  });
  return ["| Field | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** Render one named object definition as a `### Heading`, its description, and its property table. */
function renderTypeSection(name: string, definition: JsonSchema): string {
  const description = cleanDescription(definition.description);
  const parts = [`### \`${name}\``, ""];
  if (description) parts.push(description, "");
  parts.push(renderPropertiesTable(definition));
  return parts.join("\n");
}

/**
 * Render the full `launch.config.ts` field reference from its generated JSON Schema: the top-level fields
 * (the `LaunchConfigInput` root) as one table, then a `Types` section with a table per nested object
 * definition (sorted for stable output). Pure — the same markdown is printed by `launch config docs` and
 * committed as `docs/config.md`, so the two can't drift. Enum and `Record<…>` definitions render inline in
 * the type columns rather than as their own sections.
 */
export function renderConfigDocs(schema: JsonSchema): string {
  const rootName = schema.$ref ? refName(schema.$ref) : "";
  const definitions = schema.definitions ?? {};
  const root = definitions[rootName] ?? schema;

  const header =
    "<!-- AUTOGENERATED by `npm run docs:gen` — do not edit by hand; edit the config types, then regenerate. -->";
  const intro = [
    "Generated from the config types in `src/core/types.ts` by `npm run docs:gen` — edit the types, then regenerate.",
    'For editor autocomplete and validation, run `launch config schema --out launch.config.schema.json`, then point your config at it: a JSON config adds a `"$schema": "./launch.config.schema.json"` key, while a `.ts` config (which can\'t carry `$schema`) is wired through VS Code\'s `json.schemas` setting or your editor\'s equivalent.',
    "Run `launch config validate` to check a config against this schema (it also reports cross-field semantic warnings, which never fail the command); pass a `.json` file to validate it verbatim, including unknown top-level keys.",
  ].join(" ");

  const nestedTypes = Object.entries(definitions)
    .filter(([name, definition]) => name !== rootName && definition.properties !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, definition]) => renderTypeSection(name, definition));

  const parts = [
    header,
    "",
    "# Launch config reference",
    "",
    intro,
    "",
    "## Top-level fields",
    "",
    renderPropertiesTable(root),
  ];
  if (nestedTypes.length > 0) parts.push("", "## Types", "", nestedTypes.join("\n\n"));
  return `${parts.join("\n")}\n`;
}
