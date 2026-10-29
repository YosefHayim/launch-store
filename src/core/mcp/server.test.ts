import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { AppleStoreClientLive } from '../services/appleStoreClient.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { GoogleStoreClientLive } from '../services/googleStoreClient.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchSecretStoreTest } from '../services/secretStore.js';
import { makeStatsCredentialsTest } from '../stats/statsCredentials.js';
import { dispatch, pickServedTools } from './server.js';
import { STATS_TOOLS } from './statsTools.js';
import type { McpTool } from '../types/mcp.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';

/** A tool whose handler echoes a fixed payload - or throws - so `dispatch`'s boundary is graded in isolation. */
const tool = (overrides: Partial<McpTool> = {}): McpTool => {
  return {
    name: 'sample',
    description: 'sample',
    capability: 'read',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: () => Effect.succeed({ content: [{ type: 'text', text: 'ok' }] }),
    ...overrides,
  };
};

describe('dispatch', () => {
  it('returns an isError result when args fail schema validation', async () => {
    const toolOutput = await Effect.runPromise(dispatch(tool(), {}));
    expect(toolOutput.isError).toBe(true);
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toContain(
      'Invalid arguments for sample',
    );
  });
  it('runs the handler and returns its result for valid args', async () => {
    const toolOutput = await Effect.runPromise(dispatch(tool(), { name: 'x' }));
    expect(toolOutput.isError).toBeUndefined();
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toBe('ok');
  });
  it('turns a thrown handler error into an isError result carrying the message', async () => {
    const toolOutput = await Effect.runPromise(
      dispatch(
        tool({
          handler: () => Effect.fail(new Error('boom')),
        }),
        { name: 'x' },
      ),
    );
    expect(toolOutput.isError).toBe(true);
    expect(expectArrayElement(toolOutput.content, 0, 'toolOutput.content').text).toBe('boom');
  });
});

describe('pickServedTools', () => {
  const workingDirectories: string[] = [];
  afterEach(() => {
    for (const workingDirectory of workingDirectories.splice(0)) {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  const createWorkingDirectory = (): string => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'launch-mcp-'));
    workingDirectories.push(workingDirectory);
    return workingDirectory;
  };

  const pickTools = (workingDirectory: string, tools: readonly McpTool[]) =>
    Effect.runPromise(
      pickServedTools(tools, workingDirectory).pipe(
        Effect.either,
        Effect.provide(NodeContext.layer),
        Effect.provide(NodeHttpClient.layer),
        Effect.provide(makeStatsCredentialsTest()),
        Effect.provide(AppleStoreClientLive),
        Effect.provide(GoogleStoreClientLive),
        Effect.provide(makeLaunchEnvironmentTest({})),
        Effect.provide(makeLaunchSecretStoreTest()),
        Effect.provide(makeLaunchPathsTest('', workingDirectory)),
      ),
    );

  it('serves only the stats tools in a folder with no launch config', async () => {
    const workingDirectory = createWorkingDirectory();

    const outcome = await pickTools(workingDirectory, [tool({ name: 'build' })]);

    if (outcome._tag === 'Left') throw new Error('expected tools');
    expect(outcome.right).toEqual(STATS_TOOLS);
  });

  it('serves the gated tools plus the stats tools when a config exists', async () => {
    const workingDirectory = createWorkingDirectory();
    writeFileSync(
      join(workingDirectory, 'launch.config.mjs'),
      'export default { profiles: { production: { name: "production" } } };\n',
    );

    const outcome = await pickTools(workingDirectory, [tool({ name: 'sample' })]);

    if (outcome._tag === 'Left') throw new Error('expected tools');
    const toolNames = outcome.right.map((servedTool) => servedTool.name);
    expect(toolNames).toContain('sample');
    expect(toolNames).toContain('stats_portfolio');
    expect(toolNames).toContain('stats_app');
  });

  it('fails when a config exists but cannot load', async () => {
    const workingDirectory = createWorkingDirectory();
    writeFileSync(
      join(workingDirectory, 'launch.config.mjs'),
      'throw new Error("broken config");\n',
    );

    const outcome = await pickTools(workingDirectory, [tool()]);

    expect(outcome._tag).toBe('Left');
  });
});
