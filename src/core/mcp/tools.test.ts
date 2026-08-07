import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  chooseSurfacePlanners,
  DANGEROUS_TOOLS,
  DRY_RUN_TOOLS,
  type McpToolRequirements,
  optionalString,
  READ_TOOLS,
  requestedPlatform,
  requiredString,
  summarizeSnapshots,
  WRITE_TOOLS,
} from './tools.js';
import { gateTools } from './gate.js';
import type { LaunchConfig } from '../types/config.js';
import type { McpTool } from '../types/mcp.js';
import type { SurfacePlanner } from '../types/plan.js';
import type { Snapshot } from '../types/snapshot.js';
import type { McpCapability } from '../types/storeSurface.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';

/** A bare config exposing the given MCP capability tiers - only the fields the gate reads matter here. */
const config = (capabilities: McpCapability[]): LaunchConfig => {
  return {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    mcp: { capabilities },
  };
};

/** Look a tool up by its advertised name, failing loudly if the registry no longer has it. */
const byName = (name: string): McpTool<McpToolRequirements> => {
  const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} missing from ALL_TOOLS`);
  return tool;
};

/** Shared platform + domain services for registry handler tests. */
const provideToolServices = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(NodeContext.layer),
    Effect.provide(NodeHttpClient.layer),
    Effect.provide(AppleStoreClientLive),
    Effect.provide(GoogleStoreClientLive),
    Effect.provide(makeLaunchEnvironmentTest({})),
    Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
    Effect.provide(makeLaunchSecretStoreTest()),
  );

/** Parse the JSON a successful read tool emits as its single text block. */
const parseToolOutput = <DecodedOutput>(
  toolOutput: { content: { text: string }[] },
  outputSchema: Schema.Schema<DecodedOutput>,
): DecodedOutput =>
  Schema.decodeUnknownSync(outputSchema)(
    JSON.parse(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text),
  );

/** Run one registry handler with deterministic platform and domain services. */
const runTool = (tool: McpTool<McpToolRequirements>, argumentsRecord: Record<string, unknown>) =>
  Effect.runPromise(provideToolServices(tool.handler(argumentsRecord)));

const McpToolFailureSchema = Schema.Struct({
  _tag: Schema.Literal('McpToolFailure'),
  message: Schema.String,
});

const runToolFailure = async (
  tool: McpTool<McpToolRequirements>,
  argumentsRecord: Record<string, unknown>,
) => {
  const toolFailure = await Effect.runPromise(
    provideToolServices(Effect.flip(tool.handler(argumentsRecord))),
  );
  return Schema.decodeUnknownSync(McpToolFailureSchema)(toolFailure);
};

const samplePlanner = (surfaceId: string): SurfacePlanner => ({
  id: surfaceId,
  store: 'appstore',
  plan: () =>
    Effect.succeed({
      surface: surfaceId,
      store: 'appstore',
      state: 'omitted',
    }),
});

describe('READ_TOOLS registry', () => {
  it('exposes the v1 read-only surface, every tool on the read tier', () => {
    expect(READ_TOOLS.map((tool) => tool.name)).toEqual([
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
    expect(READ_TOOLS.every((tool) => tool.capability === 'read')).toBe(true);
  });
  it('gives every tool a snake_case name and an object input schema', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('DRY_RUN_TOOLS registry', () => {
  it('exposes the build_plan rehearsal on the dryRun tier', () => {
    expect(DRY_RUN_TOOLS.map((tool) => tool.name)).toEqual(['build_plan']);
    expect(DRY_RUN_TOOLS.every((tool) => tool.capability === 'dryRun')).toBe(true);
  });
});

describe('WRITE_TOOLS registry', () => {
  it('exposes the additive sync tool on the write tier', () => {
    expect(WRITE_TOOLS.map((tool) => tool.name)).toEqual(['sync']);
    expect(WRITE_TOOLS.every((tool) => tool.capability === 'write')).toBe(true);
  });
});

describe('DANGEROUS_TOOLS registry', () => {
  it('exposes the destructive sync tool on the dangerous tier', () => {
    expect(DANGEROUS_TOOLS.map((tool) => tool.name)).toEqual(['sync_destructive']);
    expect(DANGEROUS_TOOLS.every((tool) => tool.capability === 'dangerous')).toBe(true);
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
    expect(new Set(ALL_TOOLS.map((tool) => tool.name)).size).toBe(ALL_TOOLS.length);
  });
  it('gates the write and dangerous tools behind their own tiers', () => {
    const named = (tools: readonly McpTool<McpToolRequirements>[]): string[] =>
      tools.map((tool) => tool.name);
    expect(named(gateTools(ALL_TOOLS, config(['read'])))).not.toContain('sync');
    expect(named(gateTools(ALL_TOOLS, config(['read'])))).not.toContain('sync_destructive');
    const write = named(gateTools(ALL_TOOLS, config(['read', 'write'])));
    expect(write).toContain('sync');
    expect(write).not.toContain('sync_destructive');
    const dangerous = named(gateTools(ALL_TOOLS, config(['read', 'write', 'dangerous'])));
    expect(dangerous).toContain('sync');
    expect(dangerous).toContain('sync_destructive');
  });
});

describe('argument helpers', () => {
  it('optionalString returns only string values', () => {
    expect(optionalString({ app: 'ios' }, 'app')).toBe('ios');
    expect(optionalString({ app: 1 }, 'app')).toBeUndefined();
    expect(optionalString({}, 'app')).toBeUndefined();
  });

  it('requiredString fails with a tagged missing-argument message', async () => {
    const failure = await Effect.runPromise(Effect.flip(requiredString({}, 'baseline')));
    expect(failure).toEqual({
      _tag: 'McpToolFailure',
      message: '`baseline` is required.',
    });
  });

  it('requestedPlatform defaults to ios and rejects unknowns', async () => {
    expect(await Effect.runPromise(requestedPlatform({}))).toBe('ios');
    expect(await Effect.runPromise(requestedPlatform({ platform: 'android' }))).toBe('android');
    const failure = await Effect.runPromise(Effect.flip(requestedPlatform({ platform: 'web' })));
    expect(failure.message).toContain('Unknown platform "web"');
  });
});

describe('chooseSurfacePlanners', () => {
  const planners = [samplePlanner('catalog'), samplePlanner('listing')];

  it('keeps every planner when no surface is requested', async () => {
    const selected = await Effect.runPromise(chooseSurfacePlanners(planners, undefined));
    expect(selected.map((planner) => planner.id)).toEqual(['catalog', 'listing']);
  });

  it('narrows to one matching surface', async () => {
    const selected = await Effect.runPromise(chooseSurfacePlanners(planners, 'listing'));
    expect(selected.map((planner) => planner.id)).toEqual(['listing']);
  });

  it('fails with available surfaces when the id is unknown', async () => {
    const failure = await Effect.runPromise(
      Effect.flip(chooseSurfacePlanners(planners, 'missing')),
    );
    expect(failure.message).toBe('Unknown surface "missing". Available: catalog, listing.');
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
    const SchemaDefinition = Schema.Struct({
      type: Schema.optionalWith(Schema.String, { exact: true }),
    });
    const ConfigSchemaOutput = Schema.Struct({
      type: Schema.optionalWith(Schema.String, { exact: true }),
      $ref: Schema.optionalWith(Schema.String, { exact: true }),
      definitions: Schema.Record({ key: Schema.String, value: SchemaDefinition }),
    });
    const configSchema = parseToolOutput(
      await runTool(byName('config_schema'), {}),
      ConfigSchemaOutput,
    );
    // Effect Schema SSOT: nested types under `definitions` (normalized from `$defs`); root may be
    // an inline object or a `$ref` into `definitions.LaunchConfig`.
    expect(configSchema.definitions).toBeDefined();
    let rootSchema: { readonly type?: string } = configSchema;
    if (configSchema.$ref !== undefined) {
      const rootName = configSchema.$ref.split('/').pop();
      if (rootName !== undefined) {
        const referencedSchema = configSchema.definitions[rootName];
        if (referencedSchema !== undefined) rootSchema = referencedSchema;
      }
    }
    expect(rootSchema.type).toBe('object');
  });
  it('config_docs returns the field reference as Markdown', async () => {
    const docsOutput = parseToolOutput(
      await runTool(byName('config_docs'), {}),
      Schema.Struct({ markdown: Schema.String }),
    );
    expect(typeof docsOutput.markdown).toBe('string');
    expect(docsOutput.markdown.length).toBeGreaterThan(0);
  });
});

describe('snapshot tool argument guards', () => {
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
