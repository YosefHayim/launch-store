import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.js';
import type { McpTool } from '../types/mcp.js';
import type { McpCapability } from '../types/storeSurface.js';
import { enabledCapabilities, gateTools } from './gate.js';
/** A bare config with an optional `mcp` block - only the fields the gate reads matter here. */
const config = (capabilities?: McpCapability[]): LaunchConfig => {
  const launchConfig: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  if (capabilities === undefined) return launchConfig;
  return { ...launchConfig, mcp: { capabilities } };
};
/** A no-op tool of a given tier; the handler is never invoked by the gate. */
const tool = (name: string, capability: McpCapability): McpTool => {
  return {
    name,
    description: name,
    capability,
    inputSchema: { type: 'object' },
    handler: () => Effect.succeed({ content: [{ type: 'text', text: '' }] }),
  };
};
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
