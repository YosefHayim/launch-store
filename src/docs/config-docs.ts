import type { JsonSchema } from '../config/json-schema.ts';

// Escape backslashes first so they cannot hide a following markdown table delimiter.
function escapeCell(cell: string): string {
  return cell.replace(/[\\|]/g, function escapeTableDelimiter(character) {
    return `\\${character}`;
  });
}
/** Decode the trailing segment of a `$ref` into the definition name, e.g. `#/definitions/BuildProfile` -> `BuildProfile`. */
const refName = (ref: string): string => {
  let referenceSegment = ref.split('/').pop();
  if (referenceSegment == null) referenceSegment = '';
  return decodeURIComponent(referenceSegment);
};
/**
 * Resolve a `{@link Foo}` / `{@link Foo display}` / `{@link Foo | display}` tag down to plain text: the
 * display label when one is given, otherwise the symbol's last path segment (stripping any
 * `import("...").` prefix the generator emits). Keeps the reference readable instead of leaking TSDoc tags.
 */
const resolveLink = (inner: string): string => {
  const [target, ...rest] = inner.split('|');
  if (rest.length > 0) return rest.join('|').trim();
  let trimmed = target;
  if (trimmed == null) trimmed = '';
  trimmed = trimmed.trim();
  const space = trimmed.search(/\s/);
  if (space != -1) return trimmed.slice(space + 1).trim();
  const symbol = trimmed.replace(/^import\([^)]*\)\./, '');
  const symbolParts = symbol.split('.');
  const finalSymbol = symbolParts.pop();
  if (finalSymbol == null) return symbol;
  return finalSymbol;
};
/** Strip `{@link}` tags and collapse all whitespace so a JSDoc block renders as one clean table-cell line. */
export const cleanDescription = (description: string | undefined): string => {
  if (!description) return '';
  return description
    .replace(/\{@link\s+([^}]+)\}/g, (_match, inner: string) => resolveLink(inner))
    .replace(/\s+/g, ' ')
    .trim();
};
/**
 * Render a property's schema as a TypeScript-flavoured type string: `$ref`->the def name, `enum`->a literal
 * union, arrays->`T[]`, `Record<...>` from an open object, and `anyOf`/`oneOf`/`allOf` joined. Recursive, so
 * nested arrays and maps read naturally (`Record<string, BuildProfile>`, `string[]`).
 */
const renderType = (schema: JsonSchema): string => {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.enum) return schema.enum.map((enumMember) => JSON.stringify(enumMember)).join(' | ');
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.anyOf) return schema.anyOf.map(renderType).join(' | ');
  if (schema.oneOf) return schema.oneOf.map(renderType).join(' | ');
  if (schema.allOf) return schema.allOf.map(renderType).join(' & ');
  let types: readonly string[] = [];
  if (Array.isArray(schema.type)) types = schema.type;
  else if (schema.type != null) types = [schema.type];
  if (types.includes('array')) {
    if (schema.items != null) return `${renderType(schema.items)}[]`;
    return 'unknown[]';
  }
  if (types.includes('object')) {
    if (typeof schema.additionalProperties == 'object')
      return `Record<string, ${renderType(schema.additionalProperties)}>`;
    return 'object';
  }
  if (types.length > 0) return types.join(' | ');
  return 'unknown';
};
/** Render an object schema's properties as a `Field | Type | Required | Description` table (or a note when it has none). */
const renderPropertiesTable = (object: JsonSchema): string => {
  let documentedProperties = object.properties;
  if (documentedProperties == null) documentedProperties = {};
  const properties = Object.entries(documentedProperties);
  if (properties.length == 0) return '_No documented fields._';
  let requiredFields = object.required;
  if (requiredFields == null) requiredFields = [];
  const required = new Set(requiredFields);
  const rows = properties.map(([name, property]) => {
    const type = `\`${escapeCell(renderType(property))}\``;
    let need = 'No';
    if (required.has(name)) need = 'Yes';
    return `| \`${name}\` | ${type} | ${need} | ${escapeCell(cleanDescription(property.description))} |`;
  });
  return ['| Field | Type | Required | Description |', '| --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
};
/** Render one named object definition as a `### Heading`, its description, and its property table. */
const renderTypeSection = (name: string, definition: JsonSchema): string => {
  const description = cleanDescription(definition.description);
  const parts = [`### \`${name}\``, ''];
  if (description) parts.push(description, '');
  parts.push(renderPropertiesTable(definition));
  return parts.join('\n');
};
/**
 * Render the full `launch.config.ts` field reference from its generated JSON Schema: the top-level fields
 * (the `LaunchConfigInput` root) as one table, then a `Types` section with a table per nested object
 * definition (sorted for stable output). Pure - `launch config docs` prints this markdown. Enum and
 * `Record<...>` definitions render inline in the type columns rather than as their own sections.
 */
export const renderConfigDocs = (schema: JsonSchema): string => {
  let rootName = '';
  if (schema.$ref != null) rootName = refName(schema.$ref);
  let definitions = schema.definitions;
  if (definitions == null) definitions = {};
  let root = definitions[rootName];
  if (root == null) root = schema;
  const header = 'Field reference printed by `launch config docs`.';
  const intro = [
    'The config types live in `src/config/` and `src/types/config.ts`. The published copy is `schema/launch.config.schema.json`.',
    'For editor autocomplete and validation, run `launch config schema --out launch.config.schema.json`, then point your config at it: a JSON config adds a `"$schema": "./launch.config.schema.json"` key, while a `.ts` config (which can\'t carry `$schema`) is wired through VS Code\'s `json.schemas` setting or your editor\'s equivalent.',
    'Run `launch config validate` to check a config against this schema (it also reports cross-field semantic warnings, which never fail the command); pass a `.json` file to validate it verbatim, including unknown top-level keys.',
  ].join(' ');
  const nestedTypes = Object.entries(definitions)
    .filter(([name, definition]) => name != rootName && definition.properties != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, definition]) => renderTypeSection(name, definition));
  const parts = [
    header,
    '',
    '# Launch config reference',
    '',
    intro,
    '',
    '## Top-level fields',
    '',
    renderPropertiesTable(root),
  ];
  if (nestedTypes.length > 0) parts.push('', '## Types', '', nestedTypes.join('\n\n'));
  return `${parts.join('\n')}\n`;
};
