import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type { McpTool } from '../types/mcp.ts';
import type { McpCapability } from '../types/store-surface.ts';
import { enabledCapabilities, gateTools } from './gate.ts';

function sampleLaunchConfig(capabilities?: readonly McpCapability[]): LaunchConfig {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  if (capabilities == null) {
    return launchConfig;
  }

  return { ...launchConfig, mcp: { capabilities } };
}

async function idleHandler(): Promise<{ content: readonly { type: 'text'; text: string }[] }> {
  return { content: [{ type: 'text', text: '' }] };
}

function tool(name: string, capability: McpCapability): McpTool {
  return {
    name,
    description: name,
    capability,
    inputSchema: { type: 'object' },
    handler: idleHandler,
  };
}

function toolName(mcpTool: McpTool): string {
  return mcpTool.name;
}

describe('enabledCapabilities', () => {
  it('defaults to read-only when mcp config is absent', () => {
    const sampleLaunch = sampleLaunchConfig();
    expect(enabledCapabilities(sampleLaunch)).toEqual(['read']);
  });

  it('treats a declared empty list as unset and falls back to read-only', () => {
    const sampleLaunch = sampleLaunchConfig([]);
    expect(enabledCapabilities(sampleLaunch)).toEqual(['read']);
  });

  it('returns the declared tiers verbatim when non-empty', () => {
    const sampleLaunch = sampleLaunchConfig(['read', 'write']);
    expect(enabledCapabilities(sampleLaunch)).toEqual(['read', 'write']);
  });
});

describe('gateTools', () => {
  const tools = [tool('read_a', 'read'), tool('write_b', 'write'), tool('danger_c', 'dangerous')];

  it('exposes only read tools by default', () => {
    const sampleLaunch = sampleLaunchConfig();
    expect(gateTools(tools, sampleLaunch).map(toolName)).toEqual(['read_a']);
  });

  it('filters to the enabled tiers and preserves registry order', () => {
    const sampleLaunch = sampleLaunchConfig(['dangerous', 'read']);
    expect(gateTools(tools, sampleLaunch).map(toolName)).toEqual(['read_a', 'danger_c']);
  });

  it('returns nothing when no tool matches an enabled tier', () => {
    const sampleLaunch = sampleLaunchConfig();
    expect(gateTools([tool('write_b', 'write')], sampleLaunch)).toEqual([]);
  });
});
