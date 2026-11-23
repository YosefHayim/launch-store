import { describe, expect, it } from 'vitest';
import { renderConfigDocs } from './config-docs.ts';
import type { JsonSchema } from '../config/json-schema.ts';

function describeRenderPieceDocs() {
  const schema: JsonSchema = {
    $ref: '#/definitions/LaunchConfigInput',
    definitions: {
      LaunchConfigInput: {
        type: 'object',
        required: ['profiles'],
        additionalProperties: false,
        properties: {
          profiles: {
            $ref: '#/definitions/Record%3Cstring%2CBuildProfile%3E',
            description: 'Profiles keyed by name.',
          },
          appRoots: {
            type: 'array',
            items: { type: 'string' },
            description: 'Globs to scan. See {@link discoverApps}.',
          },
        },
      },
      'Record<string,BuildProfile>': {
        type: 'object',
        additionalProperties: { $ref: '#/definitions/BuildProfile' },
      },
      BuildProfile: {
        type: 'object',
        required: ['name'],
        description: 'A named build profile.',
        properties: { name: { type: 'string', description: 'Profile name.' } },
      },
    },
  };

  function rendersTheTopLevelFieldsTableWithRequiredFlagsAndRenderedTypes() {
    const docs = renderConfigDocs(schema);

    expect(docs).toContain('# Launch config reference');
    expect(docs).toContain('## Top-level fields');
    expect(docs).toContain('| `profiles` | `Record<string,BuildProfile>` | Yes |');
    expect(docs).toContain('| `appRoots` | `string[]` | No |');
  }

  it(
    'renders the top-level fields table with required flags and rendered types',
    rendersTheTopLevelFieldsTableWithRequiredFlagsAndRenderedTypes,
  );

  function rendersASectionPerNestedObjectDefinitionButNotForTheRootOrPieceEnumDefs() {
    const docs = renderConfigDocs(schema);

    expect(docs).toContain('### `BuildProfile`');
    expect(docs).toContain('A named build profile.');
    expect(docs).not.toContain('### `LaunchConfigInput`');
    expect(docs).not.toContain('### `Record<string,BuildProfile>`');
  }

  it(
    'renders a section per nested object definition but not for the root or Record/enum defs',
    rendersASectionPerNestedObjectDefinitionButNotForTheRootOrPieceEnumDefs,
  );

  function stripsLinkTagsFromRenderedDescriptions() {
    const renderDocs = renderConfigDocs(schema);
    expect(renderDocs).not.toContain('@link');
  }

  it('strips {@link} tags from rendered descriptions', stripsLinkTagsFromRenderedDescriptions);
}

describe('renderConfigDocs', describeRenderPieceDocs);
