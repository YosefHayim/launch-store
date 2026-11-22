import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type { McpTool, McpToolResult } from '../types/mcp.ts';
import type { SurfacePlanner } from '../types/plan.ts';
import type { Snapshot } from '../types/snapshot.ts';
import type { McpCapability } from '../types/store-surface.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { gateTools } from './gate.ts';
import {
  ALL_TOOLS,
  chooseSurfacePlanners,
  DANGEROUS_TOOLS,
  DRY_RUN_TOOLS,
  type McpToolFailure,
  optionalString,
  READ_TOOLS,
  requestedPlatform,
  requiredString,
  summarizeSnapshots,
  WRITE_TOOLS,
} from './tools.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

function sampleLaunchConfig(capabilities: readonly McpCapability[]): LaunchConfig {
  return {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    mcp: { capabilities },
  };
}

function isMcpToolFailure(failure: unknown): failure is McpToolFailure {
  if (failure == null) {
    return false;
  }

  if (typeof failure != 'object') {
    return false;
  }

  if ('_tag' in failure == false) {
    return false;
  }

  if (failure._tag != 'McpToolFailure') {
    return false;
  }

  if ('message' in failure == false) {
    return false;
  }

  return typeof failure.message == 'string';
}

function byName(name: string): McpTool {
  const foundTool = ALL_TOOLS.find(function isNamedTool(candidate: McpTool): boolean {
    return candidate.name == name;
  });

  if (foundTool == null) {
    throw new Error(`tool ${name} missing from ALL_TOOLS`);
  }

  return foundTool;
}

function toolName(mcpTool: McpTool): string {
  return mcpTool.name;
}

function markdownLength(docsOutput: Record<string, unknown>): number {
  const markdown = docsOutput['markdown'];

  if (typeof markdown != 'string') {
    return 0;
  }

  return markdown.length;
}

function readToolJson(toolOutput: McpToolResult): unknown {
  const textBlock = toolOutput.content[0];

  if (textBlock == null) {
    throw new Error('missing tool text');
  }

  return JSON.parse(textBlock.text);
}

async function runTool(
  mcpTool: McpTool,
  argumentsRecord: Record<string, unknown>,
): Promise<McpToolResult> {
  return mcpTool.handler(argumentsRecord);
}

async function runToolFailure(
  mcpTool: McpTool,
  argumentsRecord: Record<string, unknown>,
): Promise<McpToolFailure> {
  try {
    await mcpTool.handler(argumentsRecord);
  } catch (failure) {
    if (isMcpToolFailure(failure)) {
      return failure;
    }

    throw failure;
  }

  throw new Error('expected a tool failure');
}

function samplePlanner(surfaceId: string): SurfacePlanner {
  return {
    id: surfaceId,
    store: 'appstore',
    async plan() {
      return {
        surface: surfaceId,
        store: 'appstore',
        state: 'omitted',
      };
    },
  };
}

function referencedSchemaType(
  reference: string,
  definitions: Record<string, unknown>,
): unknown | null {
  const rootName = reference.split('/').pop();

  if (rootName == null) {
    return null;
  }

  const referencedSchema = definitions[rootName];

  const referencedSchemaObject = readPlainObject(referencedSchema);

  if (referencedSchemaObject != null) {
    return referencedSchemaObject['type'];
  }

  return null;
}

function followSchemaReference(reference: unknown, definitions: unknown): unknown | null {
  if (typeof reference != 'string') {
    return null;
  }

  const definitionsObject = readPlainObject(definitions);

  if (definitionsObject != null) {
    return referencedSchemaType(reference, definitionsObject);
  }

  return null;
}

function rootSchemaType(configSchema: Record<string, unknown>): unknown {
  const followedType = followSchemaReference(configSchema['$ref'], configSchema['definitions']);

  if (followedType != null) {
    return followedType;
  }

  return configSchema['type'];
}

describe('READ_TOOLS registry', () => {
  it('exposes the v1 read-only surface, every tool on the read tier', () => {
    expect(READ_TOOLS.map(toolName)).toEqual([
      'plan',
      'drift',
      'audit',
      'store_doctor',
      'iap_doctor',
      'config_validate',
      'config_schema',
      'config_docs',
      'snapshot_list',
      'snapshot_diff',
      'snapshot_export',
      'doctor',
    ]);
    expect(
      READ_TOOLS.every(function isReadTool(mcpTool: McpTool): boolean {
        return mcpTool.capability == 'read';
      }),
    ).toBe(true);
  });

  it('gives every tool a snake_case name and an object input schema', () => {
    for (const mcpTool of ALL_TOOLS) {
      expect(mcpTool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(mcpTool.inputSchema.type).toBe('object');
    }
  });
});

describe('DRY_RUN_TOOLS registry', () => {
  it('exposes the build_plan rehearsal on the dryRun tier', () => {
    expect(DRY_RUN_TOOLS.map(toolName)).toEqual(['build_plan']);
    expect(
      DRY_RUN_TOOLS.every(function isDryRunTool(mcpTool: McpTool): boolean {
        return mcpTool.capability == 'dryRun';
      }),
    ).toBe(true);
  });
});

describe('WRITE_TOOLS registry', () => {
  it('exposes the additive sync tool on the write tier', () => {
    expect(WRITE_TOOLS.map(toolName)).toEqual(['sync']);
    expect(
      WRITE_TOOLS.every(function isWriteTool(mcpTool: McpTool): boolean {
        return mcpTool.capability == 'write';
      }),
    ).toBe(true);
  });
});

describe('DANGEROUS_TOOLS registry', () => {
  it('exposes the destructive sync tool on the dangerous tier', () => {
    expect(DANGEROUS_TOOLS.map(toolName)).toEqual(['sync_destructive']);
    expect(
      DANGEROUS_TOOLS.every(function isDangerousTool(mcpTool: McpTool): boolean {
        return mcpTool.capability == 'dangerous';
      }),
    ).toBe(true);
  });
});

describe('ALL_TOOLS registry', () => {
  it("is every tier's registry in order, with unique names", () => {
    expect(ALL_TOOLS).toEqual([
      ...READ_TOOLS,
      ...DRY_RUN_TOOLS,
      ...WRITE_TOOLS,
      ...DANGEROUS_TOOLS,
    ]);
    expect(new Set(ALL_TOOLS.map(toolName)).size).toBe(ALL_TOOLS.length);
  });

  it('gates the write and dangerous tools behind their own tiers', () => {
    const readNames = gateTools(ALL_TOOLS, sampleLaunchConfig(['read'])).map(toolName);
    const writeNames = gateTools(ALL_TOOLS, sampleLaunchConfig(['read', 'write'])).map(toolName);
    const dangerousNames = gateTools(
      ALL_TOOLS,
      sampleLaunchConfig(['read', 'write', 'dangerous']),
    ).map(toolName);

    expect(readNames).not.toContain('sync');
    expect(readNames).not.toContain('sync_destructive');
    expect(writeNames).toContain('sync');
    expect(writeNames).not.toContain('sync_destructive');
    expect(dangerousNames).toContain('sync');
    expect(dangerousNames).toContain('sync_destructive');
  });
});

describe('argument helpers', () => {
  it('optionalString returns only string values', () => {
    expect(optionalString({ app: 'ios' }, 'app')).toBe('ios');
    expect(optionalString({ app: 1 }, 'app')).toBeUndefined();
    expect(optionalString({}, 'app')).toBeUndefined();
  });

  it('requiredString fails with a tagged missing-argument message', () => {
    let failure: McpToolFailure | null = null;

    try {
      requiredString({}, 'baseline');
    } catch (caught) {
      if (isMcpToolFailure(caught)) {
        failure = caught;
      }
    }

    expect(failure).toEqual({
      _tag: 'McpToolFailure',
      message: '`baseline` is required.',
    });
  });

  it('requestedPlatform defaults to ios and rejects unknowns', () => {
    expect(requestedPlatform({})).toBe('ios');
    expect(requestedPlatform({ platform: 'android' })).toBe('android');

    let message = '';

    try {
      requestedPlatform({ platform: 'web' });
    } catch (caught) {
      if (isMcpToolFailure(caught)) {
        message = caught.message;
      }
    }

    expect(message).toContain('Unknown platform "web"');
  });
});

describe('chooseSurfacePlanners', () => {
  const planners = [samplePlanner('catalog'), samplePlanner('listing')];

  it('keeps every planner when no surface is requested', () => {
    const selected = chooseSurfacePlanners(planners, undefined);

    expect(
      selected.map(function plannerId(planner: SurfacePlanner): string {
        return planner.id;
      }),
    ).toEqual(['catalog', 'listing']);
  });

  it('narrows to one matching surface', () => {
    const selected = chooseSurfacePlanners(planners, 'listing');

    expect(
      selected.map(function plannerId(planner: SurfacePlanner): string {
        return planner.id;
      }),
    ).toEqual(['listing']);
  });

  it('fails with available surfaces when the id is unknown', () => {
    let message = '';

    try {
      chooseSurfacePlanners(planners, 'missing');
    } catch (caught) {
      if (isMcpToolFailure(caught)) {
        message = caught.message;
      }
    }

    expect(message).toBe('Unknown surface "missing". Available: catalog, listing.');
  });
});

describe('summarizeSnapshots', () => {
  it('projects name, capture time, and report count', () => {
    const snapshots: Snapshot[] = [
      {
        version: 1,
        name: 'pre',
        capturedAt: '2026-01-01T00:00:00.000Z',
        reports: [
          {
            id: 'catalog',
            title: 'Catalog',
            store: 'appstore',
            outcome: { state: 'captured', apps: [] },
          },
          {
            id: 'listing',
            title: 'Listing',
            store: 'appstore',
            outcome: { state: 'skipped', reason: 'no credentials' },
          },
        ],
      },
    ];

    expect(summarizeSnapshots(snapshots)).toEqual([
      { name: 'pre', capturedAt: '2026-01-01T00:00:00.000Z', reports: 2 },
    ]);
  });
});

describe('config introspection tools', () => {
  it('config_schema returns the launch.config JSON Schema', async () => {
    const toolOutput = await runTool(byName('config_schema'), {});
    const configSchema = readToolJson(toolOutput);

    const configSchemaObject = readPlainObject(configSchema);

    if (configSchemaObject != null) {
      expect(configSchemaObject['definitions']).toBeDefined();
      expect(rootSchemaType(configSchemaObject)).toBe('object');

      return;
    }

    throw new Error('schema was not an object');
  });

  it('config_docs returns the field reference as Markdown', async () => {
    const toolOutput = await runTool(byName('config_docs'), {});
    const docsOutput = readToolJson(toolOutput);

    const docsOutputObject = readPlainObject(docsOutput);

    if (docsOutputObject != null) {
      expect(markdownLength(docsOutputObject)).toBeGreaterThan(0);

      return;
    }

    throw new Error('docs were not an object');
  });
});

describe('snapshot tool argument guards', () => {
  beforeEach(() => {
    useLaunchDirectories({ homeDirectory: '/test-home', workingDirectory: '/workspace' });
  });

  afterEach(() => {
    resetLaunchDirectories();
  });

  it('snapshot_diff requires a baseline', async () => {
    const toolFailure = await runToolFailure(byName('snapshot_diff'), {});

    expect(toolFailure.message).toBe('`baseline` is required.');
  });

  it('snapshot_diff throws on an unknown baseline snapshot', async () => {
    const toolFailure = await runToolFailure(byName('snapshot_diff'), {
      baseline: 'no-such-snapshot-xyz',
    });

    expect(toolFailure.message).toBe('No snapshot named "no-such-snapshot-xyz".');
  });

  it('snapshot_export requires a name', async () => {
    const toolFailure = await runToolFailure(byName('snapshot_export'), {});

    expect(toolFailure.message).toBe('`name` is required.');
  });

  it('snapshot_export throws on an unknown snapshot when not capturing', async () => {
    const toolFailure = await runToolFailure(byName('snapshot_export'), {
      name: 'no-such-snapshot-xyz',
    });

    expect(toolFailure.message).toBe('No snapshot named "no-such-snapshot-xyz".');
  });
});
