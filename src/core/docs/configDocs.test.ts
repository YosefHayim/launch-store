import { describe, expect, it } from 'vitest';
import { cleanDescription, renderConfigDocs } from './configDocs.js';
import type { JsonSchema } from '../jsonSchema.js';

describe('cleanDescription', () => {
  it("strips a bare {@link} down to the symbol's last segment", () => {
    expect(cleanDescription('See {@link ReleaseConfig.earliestReleaseDate}.')).toBe(
      'See earliestReleaseDate.',
    );
  });

  it('uses the display text of a labelled {@link}', () => {
    expect(cleanDescription('Drives {@link sync the reconciler}.')).toBe('Drives the reconciler.');
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(cleanDescription('line one\n  line two')).toBe('line one line two');
  });

  it('returns an empty string for no description', () => {
    expect(cleanDescription(undefined)).toBe('');
  });
});

describe('renderConfigDocs', () => {
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

  it('renders the top-level fields table with required flags and rendered types', () => {
    const docs = renderConfigDocs(schema);
    expect(docs).toContain('# Launch config reference');
    expect(docs).toContain('## Top-level fields');
    expect(docs).toContain('| `profiles` | `Record<string,BuildProfile>` | Yes |');
    expect(docs).toContain('| `appRoots` | `string[]` | No |');
  });

  it('renders a section per nested object definition but not for the root or Record/enum defs', () => {
    const docs = renderConfigDocs(schema);
    expect(docs).toContain('### `BuildProfile`');
    expect(docs).toContain('A named build profile.');
    expect(docs).not.toContain('### `LaunchConfigInput`');
    expect(docs).not.toContain('### `Record<string,BuildProfile>`');
  });

  it('strips {@link} tags from rendered descriptions', () => {
    expect(renderConfigDocs(schema)).not.toContain('@link');
  });
});
