import type { LaunchConfig } from '../types/config.js';
import type { McpTool } from '../types/mcp.js';
import type { McpCapability } from '../types/storeSurface.js';

/** The default when `mcp.capabilities` is absent or empty: read-only, the safest exposure. */
const DEFAULT_CAPABILITIES: readonly McpCapability[] = ['read'];

/**
 * Resolve the enabled capability tiers from a config: the declared list when non-empty, else the
 * read-only default. A declared `[]` is treated as "unset" - there is no use for a server that exposes no
 * tools, so it falls back to `read` rather than serving nothing.
 */
export function enabledCapabilities(launchConfig: LaunchConfig): readonly McpCapability[] {
  const mcpSettings = launchConfig.mcp;

  if (mcpSettings == null) {
    return DEFAULT_CAPABILITIES;
  }

  const declared = mcpSettings.capabilities;

  if (declared == null) {
    return DEFAULT_CAPABILITIES;
  }

  const isDeclaredEmpty = declared.length == 0;

  if (isDeclaredEmpty) {
    return DEFAULT_CAPABILITIES;
  }

  return declared;
}

/**
 * Filter a tool list down to those the config enables, preserving the registry's display order. The
 * server calls this with every tier's registry, so the capability opt-in stays in a single place.
 */
export function gateTools(tools: readonly McpTool[], launchConfig: LaunchConfig): McpTool[] {
  const enabled = new Set(enabledCapabilities(launchConfig));

  function isEnabled(tool: McpTool): boolean {
    return enabled.has(tool.capability);
  }

  return tools.filter(isEnabled);
}
