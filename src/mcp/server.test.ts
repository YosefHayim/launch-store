import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expectArrayElement } from '../testkit/assertions-testkit.ts';
import type { McpTool } from '../types/mcp.ts';
import { dispatch, pickServedTools } from './server.ts';
import { STATS_TOOLS } from './stats-tools.ts';

async function sampleHandler(): Promise<{ content: readonly { type: 'text'; text: string }[] }> {
  return { content: [{ type: 'text', text: 'ok' }] };
}

function tool(overrides: Partial<McpTool> = {}): McpTool {
  const sampleTool: McpTool = {
    name: 'sample',
    description: 'sample',
    capability: 'read',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    handler: sampleHandler,
  };

  return { ...sampleTool, ...overrides };
}

async function boomHandler(): Promise<{ content: readonly { type: 'text'; text: string }[] }> {
  throw new Error('boom');
}

describe('dispatch', () => {
  it('returns an isError result when args fail schema validation', async () => {
    const toolOutput = await dispatch(tool(), {});

    expect(toolOutput.isError).toBe(true);
    const arrayElement = expectArrayElement(toolOutput.content, 0, 'toolOutput.content');
    expect(arrayElement.text).toContain('Invalid arguments for sample');
  });

  it('runs the handler and returns its result for valid args', async () => {
    const toolOutput = await dispatch(tool(), { name: 'x' });

    expect(toolOutput.isError).toBeUndefined();
    const arrayElement = expectArrayElement(toolOutput.content, 0, 'toolOutput.content');
    expect(arrayElement.text).toBe('ok');
  });

  it('turns a thrown handler error into an isError result carrying the message', async () => {
    const toolOutput = await dispatch(
      tool({
        handler: boomHandler,
      }),
      { name: 'x' },
    );

    expect(toolOutput.isError).toBe(true);
    const arrayElement = expectArrayElement(toolOutput.content, 0, 'toolOutput.content');
    expect(arrayElement.text).toBe('boom');
  });
});

describe('pickServedTools', () => {
  const workingDirectories: string[] = [];

  afterEach(() => {
    for (const workingDirectory of workingDirectories.splice(0)) {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  function createWorkingDirectory(): string {
    const systemTemporaryDirectory = tmpdir();
    const launchMcpPath = join(systemTemporaryDirectory, 'launch-mcp-');
    const workingDirectory = mkdtempSync(launchMcpPath);
    workingDirectories.push(workingDirectory);

    return workingDirectory;
  }

  function servedToolName(servedTool: McpTool): string {
    return servedTool.name;
  }

  it('serves only the stats tools in a folder with no launch config', async () => {
    const workingDirectory = createWorkingDirectory();
    const servedTools = await pickServedTools([tool({ name: 'build' })], workingDirectory);

    expect(servedTools).toEqual(STATS_TOOLS);
  });

  it('serves the gated tools plus the stats tools when a config exists', async () => {
    const workingDirectory = createWorkingDirectory();

    const launchPath = join(workingDirectory, 'launch.config.mjs');
    writeFileSync(
      launchPath,
      'export default { profiles: { production: { name: "production" } } };\n',
    );

    const servedTools = await pickServedTools([tool({ name: 'sample' })], workingDirectory);
    const toolNames = servedTools.map(servedToolName);

    expect(toolNames).toContain('sample');
    expect(toolNames).toContain('stats_portfolio');
    expect(toolNames).toContain('stats_app');
  });

  it('fails when a config exists but cannot load', async () => {
    const workingDirectory = createWorkingDirectory();

    const launchPath = join(workingDirectory, 'launch.config.mjs');
    writeFileSync(launchPath, 'throw new Error("broken config");\n');

    let didFail = false;

    try {
      await pickServedTools([tool()], workingDirectory);
    } catch (cause) {
      const isFailure = cause != null;

      if (isFailure) {
        didFail = true;
      }
    }

    expect(didFail).toBe(true);
  });
});
