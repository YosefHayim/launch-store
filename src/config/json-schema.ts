import { readPlainObject } from '../services/platform/plain-object.ts';

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
  pattern?: string;
};

/** One validation failure: the dotted path to the offending value and a human-readable reason. */
export type SchemaViolation = {
  path: string;
  message: string;
};

/** The JSON type name of a runtime value, using `"null"`/`"array"` rather than the bare `typeof`. */
function jsonTypeOf(candidateValue: unknown): string {
  if (candidateValue == null) {
    return 'null';
  }

  if (Array.isArray(candidateValue)) {
    return 'array';
  }

  return typeof candidateValue;
}

/** Whether `candidateValue` satisfies a single schema `type` name (`integer` narrows `number` to whole values). */
function matchesType(candidateValue: unknown, typeName: string): boolean {
  if (typeName == 'integer') {
    return typeof candidateValue == 'number' && Number.isInteger(candidateValue);
  }

  if (typeName == 'number') {
    return typeof candidateValue == 'number';
  }

  return jsonTypeOf(candidateValue) == typeName;
}

/** Resolve a percent-encoded JSON pointer (`#/definitions/Foo`) against the root document, or undefined. */
function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith('#/')) {
    return undefined;
  }

  const pathSegments = ref.slice(2).split('/').map(decodeURIComponent);

  if (pathSegments.length != 2) {
    return undefined;
  }

  if (pathSegments[0] != 'definitions') {
    return undefined;
  }

  const definitionName = pathSegments[1];

  if (definitionName == null) {
    return undefined;
  }

  return root.definitions?.[definitionName];
}

/** Append a child key to a dotted path, bracket-quoting keys that aren't plain identifiers. */
function joinPath(path: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) {
    if (path.length > 0) {
      return `${path}.${key}`;
    }

    return key;
  }

  return `${path}[${JSON.stringify(key)}]`;
}

/** Render a schema's accepted types/enum for an error message, e.g. `string` or `"a" | "b"`. */
function describeExpected(schema: JsonSchema): string {
  if (schema.enum) {
    function quoteSchemaMember(entry: unknown) {
      return JSON.stringify(entry);
    }

    return schema.enum.map(quoteSchemaMember).join(' | ');
  }

  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ');
  }

  if (schema.type) {
    return schema.type;
  }

  if (schema.$ref) {
    let referenceName = schema.$ref.split('/').pop();

    if (referenceName == null) {
      referenceName = 'value';
    }

    return decodeURIComponent(referenceName);
  }

  return 'the expected shape';
}

function typeNames(schemaType: string | string[]): string[] {
  if (Array.isArray(schemaType)) {
    return schemaType;
  }

  return [schemaType];
}

/** Validate an object's `required`, `properties`, and `additionalProperties` constraints. */
function validateObject(
  configObject: Record<string, unknown>,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  let requiredFields = schema.required;

  if (requiredFields == null) {
    requiredFields = [];
  }

  for (const key of requiredFields) {
    if (!(key in configObject)) {
      violations.push({ path: joinPath(path, key), message: 'missing required property' });
    }
  }
  for (const [key, entry] of Object.entries(configObject)) {
    const propertySchema = schema.properties?.[key];

    if (propertySchema) {
      violations.push(...validate(entry, propertySchema, root, joinPath(path, key)));
    } else if (schema.additionalProperties == false) {
      violations.push({ path: joinPath(path, key), message: 'unknown property' });
    } else if (typeof schema.additionalProperties == 'object') {
      violations.push(...validate(entry, schema.additionalProperties, root, joinPath(path, key)));
    }
  }

  return violations;
}

/** Validate an `anyOf`/`oneOf`. A matching branch is enough. Otherwise report the branch that got furthest into the value, or one type mismatch when every branch failed at this path. */
const validateCombinator = (
  candidateValue: unknown,
  branches: JsonSchema[],
  root: JsonSchema,
  path: string,
  kind: 'anyOf' | 'oneOf',
): SchemaViolation[] => {
  const branchViolations = branches.map((branch) => validate(candidateValue, branch, root, path));

  function isBranchClean(violations: SchemaViolation[]) {
    return violations.length == 0;
  }

  const matchCount = branchViolations.filter(isBranchClean).length;
  let matchesExpectedCount = matchCount == 1;

  if (kind == 'anyOf') {
    matchesExpectedCount = matchCount >= 1;
  }

  if (matchesExpectedCount) {
    return [];
  }

  const nestedViolations = pickNestedBranchViolations(branchViolations, path);

  if (nestedViolations) {
    return nestedViolations;
  }

  const expected = branches.map((branch) => describeExpected(branch)).join(' | ');

  return [{ path, message: `expected ${expected}, got ${jsonTypeOf(candidateValue)}` }];
};

/** When every branch fails at the combinator itself, keep the short type message. A branch that got inside the value has the useful errors. */
function pickNestedBranchViolations(
  branchViolations: SchemaViolation[][],
  path: string,
): SchemaViolation[] | null {
  let chosen: SchemaViolation[] | null = null;
  let chosenDepth = -1;

  for (const violations of branchViolations) {
    let depth = -1;

    for (const violation of violations) {
      if (violation.path == path) {
        continue;
      }

      if (violation.path.length > depth) {
        depth = violation.path.length;
      }
    }

    const isDeeper = depth > chosenDepth;

    if (isDeeper) {
      chosenDepth = depth;
      chosen = violations;
    }
  }

  return chosen;
}

/** Validate `candidateValue` against `schema` */
export const validate = (
  candidateValue: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
  path = '',
): SchemaViolation[] => {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);

    if (!resolved) {
      return [{ path, message: `unresolved schema reference ${schema.$ref}` }];
    }

    return validate(candidateValue, resolved, root, path);
  }

  if (schema.anyOf) {
    return validateCombinator(candidateValue, schema.anyOf, root, path, 'anyOf');
  }

  if (schema.oneOf) {
    return validateCombinator(candidateValue, schema.oneOf, root, path, 'oneOf');
  }

  if (schema.allOf) {
    return schema.allOf.flatMap((subSchema) => validate(candidateValue, subSchema, root, path));
  }

  const violations: SchemaViolation[] = [];

  if (schema.type) {
    const expectedTypes = typeNames(schema.type);

    function acceptsListedType(typeName: string) {
      return matchesType(candidateValue, typeName);
    }

    if (!expectedTypes.some(acceptsListedType)) {
      const typeOf = jsonTypeOf(candidateValue);

      violations.push({
        path,
        message: `expected ${expectedTypes.join(' | ')}, got ${typeOf}`,
      });

      // A wrong base type makes every nested check noise.
      return violations;
    }
  }

  function isListedMember(allowed: unknown) {
    return Object.is(allowed, candidateValue);
  }

  if (schema.enum && !schema.enum.some(isListedMember)) {
    const expected = describeExpected(schema);
    const serialized = JSON.stringify(candidateValue);

    violations.push({
      path,
      message: `expected one of ${expected}, got ${serialized}`,
    });
  }

  if ('const' in schema && Object.is(schema.const, candidateValue) == false) {
    const serialized = JSON.stringify(schema.const);

    violations.push({
      path,
      message: `expected ${serialized}, got ${JSON.stringify(candidateValue)}`,
    });
  }

  if (schema.pattern != null && typeof candidateValue == 'string') {
    const stringPattern = new RegExp(schema.pattern);

    if (!stringPattern.test(candidateValue)) {
      const serialized = JSON.stringify(candidateValue);

      violations.push({
        path,
        message: `expected a string matching ${schema.pattern}, got ${serialized}`,
      });
    }
  }

  const candidateRecord = readPlainObject(candidateValue);

  if (candidateRecord != null) {
    const ownEntries = Object.entries(candidateRecord);
    const object = validateObject(Object.fromEntries(ownEntries), schema, root, path);
    violations.push(...object);
  }

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
