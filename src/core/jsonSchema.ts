/**
 * A tiny, dependency-free JSON Schema validator — just the draft-07 subset that
 * `ts-json-schema-generator` emits for Launch's config types (see `scripts/gen-docs.ts` and
 * {@link import("./configSchema.js").loadConfigSchema}). It deliberately is NOT a general-purpose
 * validator: we own the schema (it's generated from `src/core/types.ts`), so it only handles the
 * keywords that generator produces — `$ref`/`definitions`, `type` (string or array), `enum`, `const`,
 * `properties`/`required`/`additionalProperties`, `items`, and `anyOf`/`allOf`/`oneOf`.
 *
 * Why hand-rolled instead of `ajv`: it keeps Launch's runtime dependency list lean (the same reason the
 * config loaders in `config.ts`/`storeConfig.ts` hand-parse rather than pull in zod), and the schema's
 * shape is fixed and tested, so the small surface here is enough. Errors carry a dotted JSON path so
 * `launch config validate` can point the user straight at the offending field.
 */

/**
 * A JSON Schema node — the draft-07 subset the generator emits. Recursive: `properties`, `items`,
 * `additionalProperties`, and the `*Of` combinators all nest further {@link JsonSchema}s, and `$ref`
 * points (by percent-encoded JSON pointer) into the root document's {@link JsonSchema.definitions}.
 */
export interface JsonSchema {
  $schema?: string;
  /** A JSON pointer into `definitions`, percent-encoded (e.g. `#/definitions/Record%3Cstring%2CBuildProfile%3E`). */
  $ref?: string;
  /** One JSON type, or several when the value may be any of them (e.g. `["string", "boolean"]`). */
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  /** `false` forbids unknown keys; a schema validates every key not named in `properties`. */
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  /** The named subschemas `$ref` resolves against — present only on the root document. */
  definitions?: Record<string, JsonSchema>;
  description?: string;
  title?: string;
}

/** One validation failure: the dotted path to the offending value and a human-readable reason. */
export interface SchemaViolation {
  /** Dotted/bracketed path from the root, e.g. `profiles.production.sizeBudgetMB`. Empty at the root. */
  path: string;
  message: string;
}

/** The JSON type name of a runtime value, using `"null"`/`"array"` rather than the bare `typeof`. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Whether `value` satisfies a single schema `type` name (`integer` narrows `number` to whole values). */
function matchesType(value: unknown, type: string): boolean {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  return jsonTypeOf(value) === type;
}

/** Resolve a percent-encoded JSON pointer (`#/definitions/Foo`) against the root document, or undefined. */
function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = decodeURIComponent(rawSegment);
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node as JsonSchema | undefined;
}

/** Append a child key to a dotted path, bracket-quoting keys that aren't plain identifiers. */
function joinPath(path: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

/** Render a schema's accepted types/enum for an error message, e.g. `string` or `"a" | "b"`. */
function describeExpected(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((entry) => JSON.stringify(entry)).join(" | ");
  if (schema.type) return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  if (schema.$ref) return decodeURIComponent(schema.$ref.split("/").pop() ?? "value");
  return "the expected shape";
}

/**
 * Validate `value` against `schema`, collecting every violation (rather than failing on the first) so
 * `launch config validate` can report all problems at once. `root` carries the `definitions` that
 * `$ref`s resolve against — defaults to `schema`, so a self-contained document validates with one arg.
 */
export function validate(value: unknown, schema: JsonSchema, root: JsonSchema = schema, path = ""): SchemaViolation[] {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) return [{ path, message: `unresolved schema reference ${schema.$ref}` }];
    return validate(value, resolved, root, path);
  }

  if (schema.anyOf) return validateCombinator(value, schema.anyOf, root, path, "anyOf");
  if (schema.oneOf) return validateCombinator(value, schema.oneOf, root, path, "oneOf");
  if (schema.allOf) return schema.allOf.flatMap((sub) => validate(value, sub, root, path));

  const violations: SchemaViolation[] = [];

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      violations.push({ path, message: `expected ${types.join(" | ")}, got ${jsonTypeOf(value)}` });
      return violations; // a wrong base type makes every nested check noise
    }
  }

  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) {
    violations.push({ path, message: `expected one of ${describeExpected(schema)}, got ${JSON.stringify(value)}` });
  }
  if ("const" in schema && schema.const !== value) {
    violations.push({ path, message: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
  }

  if (jsonTypeOf(value) === "object")
    violations.push(...validateObject(value as Record<string, unknown>, schema, root, path));
  const { items } = schema;
  if (items && Array.isArray(value)) {
    // Array elements use bare numeric index notation (`profiles[0]`), not quoted-key notation.
    violations.push(...value.flatMap((entry, index) => validate(entry, items, root, `${path}[${index}]`)));
  }

  return violations;
}

/** Validate an object's `required`, `properties`, and `additionalProperties` constraints. */
function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  for (const key of schema.required ?? []) {
    if (!(key in value)) violations.push({ path: joinPath(path, key), message: "missing required property" });
  }
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = schema.properties?.[key];
    if (propertySchema) {
      violations.push(...validate(entry, propertySchema, root, joinPath(path, key)));
    } else if (schema.additionalProperties === false) {
      violations.push({ path: joinPath(path, key), message: "unknown property" });
    } else if (typeof schema.additionalProperties === "object") {
      violations.push(...validate(entry, schema.additionalProperties, root, joinPath(path, key)));
    }
  }
  return violations;
}

/** Validate an `anyOf`/`oneOf`: report a single, concise violation when the right number of branches don't match. */
function validateCombinator(
  value: unknown,
  branches: JsonSchema[],
  root: JsonSchema,
  path: string,
  kind: "anyOf" | "oneOf",
): SchemaViolation[] {
  const matches = branches.filter((branch) => validate(value, branch, root, path).length === 0).length;
  const ok = kind === "anyOf" ? matches >= 1 : matches === 1;
  if (ok) return [];
  const expected = branches.map((branch) => describeExpected(branch)).join(" | ");
  return [{ path, message: `expected ${expected}, got ${jsonTypeOf(value)}` }];
}
