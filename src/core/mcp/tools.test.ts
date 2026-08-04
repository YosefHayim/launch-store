import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  DANGEROUS_TOOLS,
  DRY_RUN_TOOLS,
  type McpToolRequirements,
  READ_TOOLS,
  WRITE_TOOLS,
} from './tools.js';
import { gateTools } from './gate.js';
import type { LaunchConfig } from '../types/config.js';
import type { McpTool } from '../types/mcp.js';
import type { McpCapability } from '../types/storeSurface.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
/** A bare config exposing the given MCP capability tiers - only the fields the gate reads matter here. */
const config = (capabilities: readonly McpCapability[]): LaunchConfig => {
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
/** Parse the JSON a successful read tool emits as its single text block. */
const parseToolOutput = <DecodedOutput>(
  toolOutput: { content: readonly { readonly text: string }[] },
  outputSchema: Schema.Schema<DecodedOutput>,
): DecodedOutput =>
  Schema.decodeUnknownSync(outputSchema)(
    JSON.parse(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text),
  );

/** Run one registry handler with deterministic platform and domain services. */
const runTool = (tool: McpTool<McpToolRequirements>, argumentsRecord: Record<string, unknown>) =>
  Effect.runPromise(
    tool
      .handler(argumentsRecord)
      .pipe(
        Effect.provide(NodeContext.layer),
        Effect.provide(NodeHttpClient.layer),
        Effect.provide(AppleStoreClientLive),
        Effect.provide(GoogleStoreClientLive),
        Effect.provide(makeLaunchEnvironmentTest({})),
        Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
        Effect.provide(makeLaunchSecretStoreTest()),
      ),
  );
const McpToolFailureSchema = Schema.Struct({
  _tag: Schema.Literal('McpToolFailure'),
  message: Schema.String,
});
const runToolFailure = async (
  tool: McpTool<McpToolRequirements>,
  argumentsRecord: Record<string, unknown>,
) => {
  const toolFailure = await Effect.runPromise(
    Effect.flip(tool.handler(argumentsRecord)).pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(AppleStoreClientLive),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(makeLaunchEnvironmentTest({})),
      Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
      Effect.provide(makeLaunchSecretStoreTest()),
    ),
  );
  return Schema.decodeUnknownSync(McpToolFailureSchema)(toolFailure);
};
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
