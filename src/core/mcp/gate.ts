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
export const enabledCapabilities = (config: LaunchConfig): readonly McpCapability[] => {
  const declared = config.mcp?.capabilities;
  if (declared && declared.length > 0) return declared;
  return DEFAULT_CAPABILITIES;
};
/**
 * Filter a tool list down to those the config enables, preserving the registry's display order. The
 * server calls this with {@link import("./tools.js").ALL_TOOLS} - every tier's registry (read, dryRun,
 * write, dangerous) passes through this one gate, so the capability opt-in stays in a single place.
 */
export const gateTools = <Requirements>(
  tools: readonly McpTool<Requirements>[],
  config: LaunchConfig,
): McpTool<Requirements>[] => {
  const enabled = new Set(enabledCapabilities(config));
  return tools.filter((tool) => enabled.has(tool.capability));
};
