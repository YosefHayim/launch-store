import { describe, expect, it } from 'vitest';
import type { LaunchConfig, McpCapability } from '../types.js';
import type { McpTool } from './types.js';
import { enabledCapabilities, gateTools } from './gate.js';

/** A bare config with an optional `mcp` block — only the fields the gate reads matter here. */
function config(capabilities?: McpCapability[]): LaunchConfig {
  return (capabilities ? { mcp: { capabilities } } : {}) as unknown as LaunchConfig;
}

/** A no-op tool of a given tier; the handler is never invoked by the gate. */
function tool(name: string, capability: McpCapability): McpTool {
  return {
    name,
    description: name,
    capability,
    inputSchema: { type: 'object' },
    handler: async () => ({ content: [{ type: 'text', text: '' }] }),
  };
}

describe('enabledCapabilities', () => {
  it('defaults to read-only when mcp config is absent', () => {
    expect(enabledCapabilities(config())).toEqual(['read']);
  });

  it('treats a declared empty list as unset and falls back to read-only', () => {
    expect(enabledCapabilities(config([]))).toEqual(['read']);
  });

  it('returns the declared tiers verbatim when non-empty', () => {
    expect(enabledCapabilities(config(['read', 'write']))).toEqual(['read', 'write']);
  });
});

describe('gateTools', () => {
  const tools = [tool('read_a', 'read'), tool('write_b', 'write'), tool('danger_c', 'dangerous')];

  it('exposes only read tools by default', () => {
    expect(gateTools(tools, config()).map((t) => t.name)).toEqual(['read_a']);
  });

  it('filters to the enabled tiers and preserves registry order', () => {
    expect(gateTools(tools, config(['dangerous', 'read'])).map((t) => t.name)).toEqual([
      'read_a',
      'danger_c',
    ]);
  });

  it('returns nothing when no tool matches an enabled tier', () => {
    expect(gateTools([tool('write_b', 'write')], config())).toEqual([]);
  });
});
