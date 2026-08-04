import { Schema } from 'effect';

export type JsonSchema = {
  $schema?: string;
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  definitions?: Record<string, JsonSchema>;
  description?: string;
  title?: string;
};

/** Recursive Effect Schema for the committed JSON Schema document. */
export const JsonSchemaNode: Schema.Schema<JsonSchema> = Schema.suspend(
  (): Schema.Schema<JsonSchema> =>
    Schema.Struct({
      $schema: Schema.optionalWith(Schema.String, { exact: true }),
      $ref: Schema.optionalWith(Schema.String, { exact: true }),
      type: Schema.optionalWith(
        Schema.Union(Schema.String, Schema.mutable(Schema.Array(Schema.String))),
        { exact: true },
      ),
      enum: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.Unknown)), { exact: true }),
      const: Schema.optionalWith(Schema.Unknown, { exact: true }),
      default: Schema.optionalWith(Schema.Unknown, { exact: true }),
      properties: Schema.optionalWith(
        Schema.mutable(Schema.Record({ key: Schema.String, value: JsonSchemaNode })),
        { exact: true },
      ),
      required: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
      additionalProperties: Schema.optionalWith(Schema.Union(Schema.Boolean, JsonSchemaNode), {
        exact: true,
      }),
      propertyNames: Schema.optionalWith(JsonSchemaNode, { exact: true }),
      items: Schema.optionalWith(JsonSchemaNode, { exact: true }),
      anyOf: Schema.optionalWith(Schema.mutable(Schema.Array(JsonSchemaNode)), { exact: true }),
      allOf: Schema.optionalWith(Schema.mutable(Schema.Array(JsonSchemaNode)), { exact: true }),
      oneOf: Schema.optionalWith(Schema.mutable(Schema.Array(JsonSchemaNode)), { exact: true }),
      definitions: Schema.optionalWith(
        Schema.mutable(Schema.Record({ key: Schema.String, value: JsonSchemaNode })),
        { exact: true },
      ),
      description: Schema.optionalWith(Schema.String, { exact: true }),
      title: Schema.optionalWith(Schema.String, { exact: true }),
    }),
);
/** One validation failure: the dotted path to the offending value and a human-readable reason. */
export type SchemaViolation = {
  path: string;
  message: string;
};
/** The JSON type name of a runtime value, using `"null"`/`"array"` rather than the bare `typeof`. */
const jsonTypeOf = (candidateValue: unknown): string => {
  if (candidateValue === null) return 'null';
  if (Array.isArray(candidateValue)) return 'array';
  return typeof candidateValue;
};
/** Whether `value` satisfies a single schema `type` name (`integer` narrows `number` to whole values). */
const matchesType = (candidateValue: unknown, type: string): boolean => {
  if (type === 'integer')
    return typeof candidateValue === 'number' && Number.isInteger(candidateValue);
  if (type === 'number') return typeof candidateValue === 'number';
  return jsonTypeOf(candidateValue) === type;
};
/** Resolve a percent-encoded JSON pointer (`#/definitions/Foo`) against the root document, or undefined. */
const resolveRef = (ref: string, root: JsonSchema): JsonSchema | undefined => {
  if (!ref.startsWith('#/')) return undefined;
  const pathSegments = ref.slice(2).split('/').map(decodeURIComponent);
  if (pathSegments.length !== 2) return undefined;
  if (pathSegments[0] !== 'definitions') return undefined;
  const definitionName = pathSegments[1];
  if (definitionName === undefined) return undefined;
  return root.definitions?.[definitionName];
};
/** Append a child key to a dotted path, bracket-quoting keys that aren't plain identifiers. */
const joinPath = (path: string, key: string): string => {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) {
    if (path) return `${path}.${key}`;
    return key;
  }
  return `${path}[${JSON.stringify(key)}]`;
};
/** Render a schema's accepted types/enum for an error message, e.g. `string` or `"a" | "b"`. */
const describeExpected = (schema: JsonSchema): string => {
  if (schema.enum) return schema.enum.map((entry) => JSON.stringify(entry)).join(' | ');
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (schema.type) return schema.type;
  if (schema.$ref) {
    let referenceName = schema.$ref.split('/').pop();
    if (referenceName === undefined) referenceName = 'value';
    return decodeURIComponent(referenceName);
  }
  return 'the expected shape';
};
/**
 * Validate `value` against `schema`, collecting every violation (rather than failing on the first) so a
 * caller can report all problems at once. `root` carries the `definitions` that `$ref`s resolve against -
 * defaults to `schema`, so a self-contained document validates with one arg.
 */
export const validate = (
  candidateValue: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
  path = '',
): SchemaViolation[] => {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) return [{ path, message: `unresolved schema reference ${schema.$ref}` }];
    return validate(candidateValue, resolved, root, path);
  }
  if (schema.anyOf) return validateCombinator(candidateValue, schema.anyOf, root, path, 'anyOf');
  if (schema.oneOf) return validateCombinator(candidateValue, schema.oneOf, root, path, 'oneOf');
  if (schema.allOf) return schema.allOf.flatMap((sub) => validate(candidateValue, sub, root, path));
  const violations: SchemaViolation[] = [];
  if (schema.type) {
    let types: string[];
    if (Array.isArray(schema.type)) types = schema.type;
    else types = [schema.type];
    if (!types.some((type) => matchesType(candidateValue, type))) {
      violations.push({
        path,
        message: `expected ${types.join(' | ')}, got ${jsonTypeOf(candidateValue)}`,
      });
      return violations; // a wrong base type makes every nested check noise
    }
  }
  if (schema.enum && !schema.enum.some((allowed) => allowed === candidateValue)) {
    violations.push({
      path,
      message: `expected one of ${describeExpected(schema)}, got ${JSON.stringify(candidateValue)}`,
    });
  }
  if ('const' in schema && schema.const !== candidateValue) {
    violations.push({
      path,
      message: `expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(candidateValue)}`,
    });
  }
  if (
    typeof candidateValue === 'object' &&
    candidateValue !== null &&
    !Array.isArray(candidateValue)
  )
    violations.push(
      ...validateObject(Object.fromEntries(Object.entries(candidateValue)), schema, root, path),
    );
  const { items } = schema;
  if (items && Array.isArray(candidateValue)) {
    // Array elements use bare numeric index notation (`profiles[0]`), not quoted-key notation.
    violations.push(
      ...candidateValue.flatMap((entry, index) =>
        validate(entry, items, root, `${path}[${index}]`),
      ),
    );
  }
  return violations;
};
/** Validate an object's `required`, `properties`, and `additionalProperties` constraints. */
const validateObject = (
  configObject: Record<string, unknown>,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
): SchemaViolation[] => {
  const violations: SchemaViolation[] = [];
  let requiredFields = schema.required;
  if (requiredFields === undefined) requiredFields = [];
  for (const key of requiredFields) {
    if (!(key in configObject))
      violations.push({ path: joinPath(path, key), message: 'missing required property' });
  }
  for (const [key, entry] of Object.entries(configObject)) {
    const propertySchema = schema.properties?.[key];
    if (propertySchema) {
      violations.push(...validate(entry, propertySchema, root, joinPath(path, key)));
    } else if (schema.additionalProperties === false) {
      violations.push({ path: joinPath(path, key), message: 'unknown property' });
    } else if (typeof schema.additionalProperties === 'object') {
      violations.push(...validate(entry, schema.additionalProperties, root, joinPath(path, key)));
    }
  }
  return violations;
};
/** Validate an `anyOf`/`oneOf`: report a single, concise violation when the right number of branches don't match. */
const validateCombinator = (
  candidateValue: unknown,
  branches: readonly JsonSchema[],
  root: JsonSchema,
  path: string,
  kind: 'anyOf' | 'oneOf',
): SchemaViolation[] => {
  const matches = branches.filter(
    (branch) => validate(candidateValue, branch, root, path).length === 0,
  ).length;
  let ok = matches === 1;
  if (kind === 'anyOf') ok = matches >= 1;
  if (ok) return [];
  const expected = branches.map((branch) => describeExpected(branch)).join(' | ');
  return [{ path, message: `expected ${expected}, got ${jsonTypeOf(candidateValue)}` }];
};
